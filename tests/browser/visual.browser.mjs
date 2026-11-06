import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const evidenceDir = process.env.EBR71_EVIDENCE_DIR;
const nestEvidenceDir = process.env.EBR48_EVIDENCE_DIR;
const proof = {};
let devServer;
let previewServer;
let browser;
let devUrl;
let previewUrl;

function serverUrl(server) {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  if (nestEvidenceDir) await mkdir(nestEvidenceDir, { recursive: true });
  devServer = await createServer({
    configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await devServer.listen();
  devUrl = serverUrl(devServer.httpServer);
  previewServer = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  previewUrl = serverUrl(previewServer.httpServer);
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  if (evidenceDir) await writeFile(join(evidenceDir, 'browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await devServer?.close();
  if (previewServer) await new Promise((resolve) => previewServer.httpServer.close(resolve));
});

async function openPage(context, url, inspectScene = false) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  if (inspectScene) {
    // Test-only access for positions and projection; no test globals ship in the app.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = `${await response.text()}\nwindow.__ebr71Test = { scene, camera, character, controls, follow, renderer, composer };\n`;
      await route.fulfill({ response, body });
    });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.getPixelRendering && window.getWeather));
  if (inspectScene) await page.waitForFunction(() => Boolean(window.__ebr71Test));
  return { page, errors };
}

async function capture(page, name) {
  if (evidenceDir) await page.screenshot({ path: join(evidenceDir, name) });
}

async function assertNoSimUi(page) {
  const forbidden = [
    '.farm-supplies', '.farm-growing', '.farm-inventory', '.farm-market', '.farm-build',
    '.interaction-prompt', '.interaction-feedback', '[data-collect]', '[data-sell-egg]',
    '[data-buy-feed]', '[data-place-fence]', '[data-build-toggle]',
  ];
  assert.equal(await page.locator(forbidden.join(',')).count(), 0);
  // Free fence placement is present, but the stripped simulation UI stays absent.
  assert.doesNotMatch(await page.locator('body').innerText(), /\b(inventory|collect|egg|feed|supplies|buy|sell|market|build)\b/i);
}

async function worldPoint(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__ebr71Test;
    camera.updateMatrixWorld();
    const point = character.position.clone().set(x, character.position.y, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, { x, z });
}

async function objectPoint(page, name, height) {
  return page.evaluate(({ name, height }) => {
    const { scene, camera, character } = window.__ebr71Test;
    const object = scene.getObjectByName(name);
    const point = object.getWorldPosition(character.position.clone());
    point.y += height;
    camera.updateMatrixWorld();
    point.project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, { name, height });
}

async function walkTo(page, x, z) {
  const point = await worldPoint(page, x, z);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(({ x, z }) => {
    const { character } = window.__ebr71Test;
    return Math.hypot(character.position.x - x, character.position.z - z) < 0.2;
  }, { x, z }, { timeout: 15000 });
}

function nearArray(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < tolerance, `${actual} differs from ${expected}`));
}

test('production build walks without sim, interaction, or Build UI', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${previewUrl}/?phase=daytime&weather=clear`);
  const webgl = await page.evaluate(() => {
    const gl = document.querySelector('#scene').getContext('webgl2');
    return gl?.getParameter(gl.VERSION);
  });
  assert.match(webgl, /WebGL 2\.0/);
  const pixel = await page.evaluate(() => window.getPixelRendering());
  assert.equal(pixel.enabled, true);
  assert.deepEqual([pixel.canvasWidth, pixel.canvasHeight], [320, 180]);
  await assertNoSimUi(page);
  const beforeWalk = await page.screenshot();
  await page.keyboard.down('s');
  await page.waitForTimeout(800);
  await page.keyboard.up('s');
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await assertNoSimUi(page);
  const afterWalk = await page.screenshot();
  assert.equal(beforeWalk.equals(afterWalk), false, 'WASD should move the visible farm view');
  await capture(page, 'production-day-walk.png');

  await page.evaluate(() => { window.setDayNightPhase('night'); window.setWeather('rain'); });
  await page.waitForFunction(() => document.querySelector('[data-phase]')?.textContent === 'Night');
  await page.waitForFunction(() => window.getWeather().rainAmount > 0.99, null, { timeout: 15000 });
  await assertNoSimUi(page);
  await capture(page, 'production-night-rain.png');
  assert.deepEqual(errors, []);
  proof.production = { browser: browser.version(), webgl, pixel: [pixel.canvasWidth, pixel.canvasHeight], walked: true, nightRain: true, simUi: false, errors };
});

test('walking and clicking around former interaction targets leaves only static scenery', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime&weather=clear`, true);
  await page.keyboard.down('s');
  try {
    await page.waitForFunction(() => {
      const { scene, character } = window.__ebr71Test;
      const chicken = scene.getObjectByName('farm-chicken');
      return Math.hypot(character.position.x - chicken.position.x, character.position.z - chicken.position.z) <= 1.35;
    }, null, { timeout: 15000 });
  } finally {
    await page.keyboard.up('s');
  }
  await page.keyboard.press('e');
  await page.keyboard.press('e');
  await assertNoSimUi(page);
  await capture(page, 'dev-chicken-no-prompt.png');

  const beforeClick = await page.evaluate(() => window.__ebr71Test.character.position.toArray());
  const chickenPoint = await objectPoint(page, 'farm-chicken', 0.44);
  await page.mouse.click(chickenPoint.x, chickenPoint.y);
  await page.waitForFunction((start) => {
    const { character } = window.__ebr71Test;
    return Math.hypot(character.position.x - start[0], character.position.z - start[2]) > 0.08;
  }, beforeClick, { timeout: 10000 });
  await assertNoSimUi(page);

  // The relocated nest is on the far bank; use the walkable bridge to reach it.
  for (const [x, z] of [[0, 0], [2.5, -1.7], [3.4, -1.93], [4.3, -1.95], [5.15, -1.65], [4.8, 0]]) {
    await walkTo(page, x, z);
  }
  const nestDistance = await page.evaluate(() => {
    const { scene, character } = window.__ebr71Test;
    const nest = scene.getObjectByName('farm-nest-decoration');
    return Math.hypot(character.position.x - nest.position.x, character.position.z - nest.position.z);
  });
  assert.ok(nestDistance < 1.1, `could not approach the relocated nest: ${nestDistance}`);
  if (nestEvidenceDir) {
    // A second, test-only camera angle exposes the nest behind tree 2 without
    // moving or hiding any scenery and leaves the actual walking test alone.
    const detail = await openPage(context, `${devUrl}/?phase=daytime&weather=clear`, true);
    await detail.page.evaluate(() => {
      const { scene, camera, character, renderer, composer } = window.__ebr71Test;
      renderer.setAnimationLoop(null);
      const target = scene.getObjectByName('farm-nest-decoration').getWorldPosition(character.position.clone());
      target.y += 0.3;
      camera.position.copy(target).add(character.position.clone().set(12, 12, -12));
      camera.lookAt(target);
      camera.zoom = 2.3;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      composer.render(0);
    });
    await detail.page.screenshot({ path: join(nestEvidenceDir, 'nest-new-spot.png') });
    assert.deepEqual(detail.errors, []);
    await detail.page.close();
  }
  await page.keyboard.press('e');
  const nestPoint = await objectPoint(page, 'farm-nest-decoration', 0.24);
  await page.mouse.click(nestPoint.x, nestPoint.y);
  await page.waitForTimeout(200);
  await assertNoSimUi(page);
  assert.equal(await page.evaluate(() => window.__ebr71Test.scene.getObjectByName('farm-nest-decoration').visible), true);

  for (const [x, z] of [[5.15, -1.65], [4.3, -1.95], [3.4, -1.93], [2.5, -1.7]]) {
    await walkTo(page, x, z);
  }

  // The sign itself is now close to the locked coop A; approach from the
  // walkable side rather than demanding a destination inside its collider.
  await walkTo(page, 1.1, -1.85);
  await page.keyboard.press('e');
  const signPoint = await objectPoint(page, 'farm-sign', 1.05);
  await page.mouse.click(signPoint.x, signPoint.y);
  await page.waitForTimeout(200);
  await assertNoSimUi(page);
  await walkTo(page, 0, 0);
  await walkTo(page, -2.8, -0.75);
  const lidRotation = await page.evaluate(() => window.__ebr71Test.scene.getObjectByName('farm-bin').children[1].rotation.x);
  await page.keyboard.press('e');
  const binPoint = await objectPoint(page, 'farm-bin', 0.35);
  await page.mouse.click(binPoint.x, binPoint.y);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__ebr71Test.scene.getObjectByName('farm-bin').children[1].rotation.x), lidRotation);
  await assertNoSimUi(page);
  await capture(page, 'dev-bin-no-prompt.png');
  assert.deepEqual(errors, []);
  proof.formerTargets = { approached: ['chicken', 'nest', 'sign', 'bin'], pressedEAndClickedEach: true, chickenClickWalked: true, simUi: false, errors };
});

test('fixed WASD and ground-click steps retain main-branch movement and camera', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime&weather=clear`, true);
  await page.evaluate(() => window.__ebr71Test.renderer.setAnimationLoop(null));
  await page.keyboard.down('s');
  await page.evaluate(() => {
    const s = window.__ebr71Test;
    s.controls.update(0.5);
    s.follow(s.character.position);
    s.composer.render(0);
  });
  await page.keyboard.up('s');
  const walk = await page.evaluate(() => ({
    position: window.__ebr71Test.character.position.toArray(),
    camera: window.__ebr71Test.camera.position.toArray(),
    rotation: window.__ebr71Test.character.rotation.y,
  }));
  // Compare the same movement on the still-clear side of the new stream.
  nearArray(walk.position, [1.2374368670764582, 2.4, 1.2374368670764582]);
  nearArray(walk.camera, [13.237436867076458, 15.1, 13.237436867076458]);
  assert.ok(Math.abs(walk.rotation - Math.PI / 4) < 1e-6);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__ebr71Test));
  await page.evaluate(() => window.__ebr71Test.renderer.setAnimationLoop(null));
  const target = await worldPoint(page, 3.2, -0.3);
  await page.mouse.click(target.x, target.y);
  await page.evaluate(() => {
    const s = window.__ebr71Test;
    s.controls.update(0.6);
    s.follow(s.character.position);
    s.composer.render(0);
  });
  const click = await page.evaluate(() => ({
    position: window.__ebr71Test.character.position.toArray(),
    camera: window.__ebr71Test.camera.position.toArray(),
  }));
  nearArray(click.position, [2.0908318766137595, 2.4, -0.1960154681033713]);
  nearArray(click.camera, [14.090831876613759, 15.1, 11.803984531896628]);
  assert.deepEqual(errors, []);
  proof.mainMovementComparison = { walk, click, errors };
});

test('night lights, weather controls, phase and pixel rendering remain usable', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=night&weather=cloudy`, true);
  await page.waitForFunction(() => window.getWeather().cloudyAmount > 0.99, null, { timeout: 15000 });
  assert.equal(await page.locator('[data-phase]').textContent(), 'Night');
  const lights = await page.evaluate(() => {
    const { scene, character } = window.__ebr71Test;
    return {
      windows: [1, 2].map((i) => scene.getObjectByName(`window-light-${i}`).intensity),
      panes: [1, 2].map((i) => scene.getObjectByName(`cottage-window-${i}`).material.emissiveIntensity),
      lantern: character.getObjectByName('lantern-light').intensity,
      glass: character.getObjectByName('lantern-glass').material.emissiveIntensity,
    };
  });
  assert.deepEqual(lights, { windows: [0.85, 0.85], panes: [0.85, 0.85], lantern: 0.12, glass: 0.55 });
  await capture(page, 'night-cloudy.png');

  await page.evaluate(() => window.setWeather('rain'));
  await page.waitForFunction(() => window.getWeather().rainAmount > 0.99 && window.getWeather().cloudyAmount < 0.01, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.getWeather().mode), 'rain');
  assert.deepEqual(await page.evaluate(() => [
    window.__ebr71Test.scene.getObjectByName('window-light-1').intensity,
    window.__ebr71Test.character.getObjectByName('lantern-light').intensity,
  ]), [0.85, 0.12]);
  await capture(page, 'night-rain.png');
  await page.evaluate(() => window.setWeather('clear'));
  await page.waitForFunction(() => window.getWeather().rainAmount < 0.01, null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => window.getWeather().mode), 'clear');

  await page.evaluate(() => window.setPixelRendering(false));
  assert.equal(await page.evaluate(() => window.getPixelRendering().canvasWidth), 1280);
  await page.evaluate(() => window.setPixelRendering(true));
  assert.equal(await page.evaluate(() => window.getPixelRendering().canvasWidth), 320);
  await page.evaluate(() => window.setDayNightPhase('sunset'));
  await page.waitForFunction(() => document.querySelector('[data-phase]')?.textContent === 'Sunset');
  await page.evaluate(() => window.setDayNightPhase('night'));
  await page.waitForFunction(() => document.querySelector('[data-phase]')?.textContent === 'Night');
  await page.evaluate(() => window.setDayNightCycleSeconds(4));
  await page.waitForFunction(() => document.querySelector('[data-phase]')?.textContent === 'Morning', null, { timeout: 15000 });
  await assertNoSimUi(page);
  assert.deepEqual(errors, []);
  proof.environment = { weather: ['cloudy', 'rain', 'clear'], phases: ['night', 'sunset', 'night', 'morning (cycle)'], pixelWidths: [320, 1280, 320], lights, errors };
});

test('small screens keep the phase label and touch-to-walk without sim UI', { timeout: 90000 }, async () => {
  const sizes = [];
  for (const [width, height, mobile] of [[320, 568, true], [390, 844, true], [844, 390, false], [480, 320, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    try {
      const { page, errors } = await openPage(context, `${previewUrl}/?phase=daytime`);
      const biome = await page.locator('.farm-biome').boundingBox();
      assert.ok(biome.x >= 0 && biome.y >= 0 && biome.x + biome.width <= width && biome.y + biome.height <= height);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await assertNoSimUi(page);
      assert.deepEqual(errors, []);
      sizes.push({ width, height, errors });
    } finally {
      await context.close();
    }
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
    const point = await worldPoint(page, 1.75, 1.75);
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(() => {
      const { character } = window.__ebr71Test;
      return Math.hypot(character.position.x, character.position.z) > 0.5;
    }, null, { timeout: 15000 });
    await assertNoSimUi(page);
    await capture(page, 'mobile-touch-walk.png');
    assert.deepEqual(errors, []);
    proof.responsive = { sizes, touchWalked: true, errors };
  } finally {
    await context.close();
  }
});
