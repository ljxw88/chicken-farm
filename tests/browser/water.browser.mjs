import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { closeSkyForWorldTests } from './skyTestUtils.mjs';
import { createServer } from 'vite';

const evidenceDir = process.env.EBR48_EVIDENCE_DIR;
const proof = { screenshots: [] };
let server;
let browser;
let url;

before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  proof.browser = `Chromium ${browser.version()} (headless, SwiftShader)`;
  proof.viewport = '1280x720';
});

after(async () => {
  if (evidenceDir) await writeFile(join(evidenceDir, 'phase2-browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await server?.close();
});

async function openPage(context, phase = 'daytime', weather = 'clear') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  // State is exposed for projection and measurement only. Walking and
  // placement use the real canvas, mouse and keyboard.
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr48Test = { scene, camera, character, obstacles, splashExclusions };\n` });
  });
  await page.goto(`${url}/?phase=${phase}&weather=${weather}`, { waitUntil: 'networkidle' });
  await closeSkyForWorldTests(page);
  await page.waitForFunction(() => Boolean(window.__ebr48Test && window.getPixelRendering?.().canvasWidth));
  if (weather === 'rain') await page.waitForFunction(() => window.getWeather().rainAmount > 0.99, null, { timeout: 15000 });
  return { page, errors };
}

async function capture(page, name) {
  const screenshot = await page.screenshot(evidenceDir ? { path: join(evidenceDir, name) } : {});
  if (evidenceDir) proof.screenshots.push(name);
  return screenshot;
}

async function worldPoint(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__ebr48Test;
    camera.updateMatrixWorld();
    const point = character.position.clone().set(x, 2.4, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, { x, z });
}

async function moveWorld(page, x, z) {
  const point = await worldPoint(page, x, z);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  await page.mouse.move(point.x, point.y);
  return point;
}

async function walkTo(page, x, z) {
  const point = await moveWorld(page, x, z);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(({ x, z }) => {
    const p = window.__ebr48Test.character.position;
    return Math.hypot(p.x - x, p.z - z) < 0.05;
  }, { x, z }, { timeout: 20000 });
}

async function holdUntil(page, keys, predicate, dwell = 0) {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await page.waitForFunction(predicate, null, { timeout: 15000 });
    if (dwell) await page.waitForTimeout(dwell);
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}

async function waterfallPixels(page, screenshot) {
  const points = await page.evaluate(() => {
    const { scene, camera } = window.__ebr48Test;
    camera.updateMatrixWorld();
    const point = scene.getObjectByName('farm-waterfall-face').position.clone();
    return [3.15, 3.3, 3.45, 3.6, 3.75, 3.9, 4.05].flatMap((x) => [0.4, 1, 1.6, 2.1].map((y) => {
      const p = point.clone().set(x, y, 8.061).project(camera);
      return [Math.round((p.x + 1) * 640), Math.round((1 - p.y) * 360)];
    }));
  });
  const pixels = await page.evaluate(async ({ data, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]);
  }, { data: screenshot.toString('base64'), points });
  const luma = pixels.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  return { mean: luma.reduce((sum, value) => sum + value, 0) / luma.length, max: Math.max(...luma), samples: pixels.length };
}

test('day, sunset, night and rain retain the pixel pass, three original lights and a visible waterfall', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const phases = {};
  for (const [phase, weather, name] of [
    ['daytime', 'clear', '05-day-front.png'], ['sunset', 'clear', '06-sunset.png'],
    ['night', 'clear', '07-night.png'], ['daytime', 'rain', '08-rain.png'],
  ]) {
    const { page, errors } = await openPage(context, phase, weather);
    const state = await page.evaluate(() => {
      const { scene, splashExclusions } = window.__ebr48Test;
      const lights = [];
      scene.traverse((object) => { if (object.isPointLight) lights.push(object.name); });
      const water = scene.getObjectByName('farm-water-feature');
      const emissives = [];
      water.traverse((object) => { if (object.isMesh) emissives.push(object.material.emissive.getHex()); });
      return { lights: lights.sort(), emissives, pixel: window.getPixelRendering(), weather: window.getWeather(),
        excludesDeck: splashExclusions.some((entry) => entry.name === 'wooden-bridge'),
        excludesWater: splashExclusions.some((entry) => entry.name.startsWith('stream-water-')) };
    });
    assert.deepEqual(state.lights, ['lantern-light', 'window-light-1', 'window-light-2']);
    assert.ok(state.emissives.every((value) => value === 0));
    assert.equal(state.pixel.enabled, true);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight, state.pixel.cssPixelSize], [320, 180, 4]);
    assert.ok(state.excludesDeck && state.excludesWater);
    if (weather === 'rain') assert.ok(state.weather.rainAmount > 0.99);
    const screenshot = await capture(page, name);
    const pixels = await waterfallPixels(page, screenshot);
    assert.ok(pixels.mean > 25, `${phase}/${weather} waterfall not distinguishable: ${pixels.mean}`);
    assert.deepEqual(errors, []);
    phases[`${phase}-${weather}`] = { pixels, lights: state.lights, pixel: state.pixel, errors };
    await page.close();
  }
  assert.ok(phases['night-clear'].pixels.mean < phases['daytime-clear'].pixels.mean, 'water must darken at night');
  proof.appearance = phases;
});

test('real WASD and click cross the graded bridge; water blocks sideways and off-bridge movement', { timeout: 120000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  await walkTo(page, 2.5, -1.7);
  await walkTo(page, 2.5, -1.95);
  await page.evaluate(() => {
    const { camera } = window.__ebr48Test;
    camera.zoom = 2;
    camera.updateProjectionMatrix(); // Test-only close-up; the application camera is unchanged.
    window.__ebr48Stage = 'wasd';
    window.__ebr48Frames = [];
    function record() {
      const p = window.__ebr48Test.character.position;
      window.__ebr48Frames.push({ stage: window.__ebr48Stage, x: p.x, y: p.y, z: p.z });
      requestAnimationFrame(record);
    }
    requestAnimationFrame(record);
  });
  await holdUntil(page, ['s', 'd'], () => window.__ebr48Test.character.position.x > 3.65); // World +X.
  const middle = await page.evaluate(() => window.__ebr48Test.character.position.toArray());
  assert.ok(middle[0] >= 3.65 && middle[0] < 4.3, `missed bridge midpoint: ${middle}`);
  assert.ok(Math.abs(middle[1] - 2.52) < 1e-5);
  await capture(page, '09-bridge-mid-crossing.png');
  await holdUntil(page, ['s', 'd'], () => window.__ebr48Test.character.position.x > 5.1);
  const east = await page.evaluate(() => window.__ebr48Test.character.position.toArray());
  assert.ok(Math.abs(east[1] - 2.4) < 1e-5);

  await page.evaluate(() => { window.__ebr48Stage = 'click'; });
  await walkTo(page, 2.5, -1.95);
  const west = await page.evaluate(() => window.__ebr48Test.character.position.toArray());
  await walkTo(page, 3.9, -1.95);
  await holdUntil(page, ['s', 'a'], () => window.__ebr48Test.character.position.z > -1.72, 450); // World +Z.
  const side = await page.evaluate(() => window.__ebr48Test.character.position.toArray());
  assert.ok(side[2] <= -1.65 + 1e-5 && side[2] > -1.75, `sideways step escaped the deck: ${side}`);

  await walkTo(page, 2.5, -1.95);
  await walkTo(page, 1.3, 0.2);
  await walkTo(page, 1.2, 3.6);
  await holdUntil(page, ['s', 'd'], () => window.__ebr48Test.character.position.x > 1.5, 600);
  const blocked = await page.evaluate(() => window.__ebr48Test.character.position.toArray());
  assert.ok(blocked[0] < 2.0, `walked through stream: ${blocked}`);
  await capture(page, '13-stream-walk-blocked.png');
  const frames = await page.evaluate(() => window.__ebr48Frames);
  const wasd = frames.filter((frame) => frame.stage === 'wasd');
  const clicked = frames.filter((frame) => frame.stage === 'click' && frame.x >= 3.2 && frame.x <= 4.6);
  assert.ok(wasd.some((frame) => frame.y > 2.4 && frame.y < 2.52), 'no sampled graded approach');
  assert.ok(wasd.some((frame) => Math.abs(frame.y - 2.52) < 1e-5));
  assert.ok(clicked.some((frame) => Math.abs(frame.y - 2.52) < 1e-5), 'click failed to traverse deck height');
  for (let i = 1; i < wasd.length; i++) {
    assert.ok(Math.abs(wasd[i].y - wasd[i - 1].y) <= 0.4 * Math.abs(wasd[i].x - wasd[i - 1].x) + 1e-5,
      'unexpected vertical step on the bridge');
  }
  assert.deepEqual(errors, []);
  proof.walking = { middle, east, west, side, blocked, sampledFrames: frames.length, errors };
});

test('a 1280x720 close-up shows the waterfall at the +Z rim', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  await walkTo(page, 1.2, 6.3);
  await page.evaluate(() => {
    const { camera } = window.__ebr48Test;
    camera.zoom = 1.8;
    camera.updateProjectionMatrix();
  });
  await capture(page, '10-waterfall-plus-z-rim.png');
  assert.deepEqual(errors, []);
});

test('real ghosts reject water and the complete walkable deck', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  await page.evaluate(() => {
    window.__ebr48Test.camera.zoom = 1.6; // Test-only close-up of the previews.
    window.__ebr48Test.camera.updateProjectionMatrix();
  });
  const checks = [];
  for (const kind of ['fence', 'plot']) {
    await page.keyboard.press(kind === 'fence' ? 'f' : 'p');
    let point = await moveWorld(page, 2.25, 3.75);
    assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
    assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
    if (kind === 'fence') await capture(page, '11-water-ghost-rejected.png');
    await page.mouse.click(point.x, point.y);
    checks.push(`${kind}: water`);

    if (kind === 'plot') await page.keyboard.press('r');
    if (kind === 'fence') {
      point = await moveWorld(page, 3.9, -1.95);
      assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
      await capture(page, '12-deck-ghost-rejected.png');
      await page.mouse.click(point.x, point.y);
    }
    point = await moveWorld(page, 5.25, -0.75); // Only the edge of the 1.5-unit tile overlaps the deck.
    assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
    assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__ebr48Test.scene.getObjectByName('placement-wash').material.color.getHex()), 0xc45a3a);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate((name) => window.__ebr48Test.scene.getObjectsByProperty('name', `placed-${name}`).length, kind), 0);
    checks.push(`${kind}: partial deck tile`);
  }
  assert.deepEqual(errors, []);
  proof.placement = { checks, errors };
});
