import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const evidenceDir = process.env.EBR46_EVIDENCE_DIR;
let devServer;
let browser;
let url = process.env.EBR46_URL;
let proof;

before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  if (!url) {
    devServer = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
    await devServer.listen();
    const address = devServer.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    url = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  if (evidenceDir && proof) await writeFile(join(evidenceDir, 'browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await devServer?.close();
});

async function capture(page, name) {
  if (evidenceDir) await page.screenshot({ path: join(evidenceDir, name) });
}

function collectErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
}

async function holdUntil(page, keys, predicate) {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await page.waitForFunction(predicate, null, { timeout: 20000 });
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}

function assertNoClipping(frame, boxes) {
  const radius = 0.4;
  const center = [frame.x, frame.y + radius, frame.z];
  for (const box of boxes) {
    const mins = [box.minX, box.minY, box.minZ];
    const maxs = [box.maxX, box.maxY, box.maxZ];
    const distanceSquared = center.reduce((sum, value, axis) => {
      const nearest = Math.max(mins[axis], Math.min(maxs[axis], value));
      return sum + (value - nearest) ** 2;
    }, 0);
    assert.ok(distanceSquared >= radius ** 2 - 1e-6, `capsule clipped a riser: ${JSON.stringify(frame)}`);
  }

  for (let i = 0; i < 64; i++) {
    const x = frame.x + radius * Math.cos(i * Math.PI / 32);
    const z = frame.z + radius * Math.sin(i * Math.PI / 32);
    const onIsland = Math.abs(x) <= 8 + 1e-6 && Math.abs(z) <= 8 + 1e-6;
    const onStone = boxes.some((box) => x >= box.minX - 1e-6 && x <= box.maxX + 1e-6 &&
      z >= box.minZ - 1e-6 && z <= box.maxZ + 1e-6);
    assert.ok(onIsland || onStone, `footprint over void: ${JSON.stringify(frame)}`);
  }
}

test('real clicks and WASD traverse the visible stairs without clipping', { timeout: 120000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const errors = [];

  // The overview is the unmodified dev app; the second page exposes only
  // scene state for measurement, following the existing browser-test pattern.
  const overview = await context.newPage();
  collectErrors(overview, errors);
  await overview.goto(`${url}/?phase=daytime`, { waitUntil: 'networkidle' });
  const rendering = await overview.evaluate(() => ({
    pixel: window.getPixelRendering(),
    webgl: document.querySelector('#scene').getContext('webgl2')?.getParameter(7938),
  }));
  assert.equal(rendering.pixel.enabled, true);
  assert.equal(rendering.pixel.cssPixelSize, 4);
  assert.deepEqual([rendering.pixel.canvasWidth, rendering.pixel.canvasHeight], [320, 180]);
  assert.match(rendering.webgl, /WebGL 2\.0/);
  await capture(overview, '01-daytime-overview.png');
  await overview.close();

  const page = await context.newPage();
  collectErrors(page, errors);
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr46Test = { scene, camera, character, stairs };\n` });
  });
  await page.goto(`${url}/?phase=daytime`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__ebr46Test));
  await page.locator('[data-growing-toggle]').click();

  const geometry = await page.evaluate(() => {
    const { scene, stairs } = window.__ebr46Test;
    return {
      background: scene.background.getHex(),
      ground: scene.getObjectByName('island-top').geometry.parameters,
      boxes: stairs.treads.map((mesh) => {
        const p = mesh.getWorldPosition(mesh.position.clone());
        const { width, height, depth } = mesh.geometry.parameters;
        return {
          minX: p.x - width / 2, maxX: p.x + width / 2,
          minY: p.y - height / 2, maxY: p.y + height / 2,
          minZ: p.z - depth / 2, maxZ: p.z + depth / 2,
        };
      }),
    };
  });
  assert.equal(geometry.background, 0x101416);
  assert.deepEqual([geometry.ground.width, geometry.ground.height], [16, 16]);
  assert.equal(geometry.boxes.length, 5);
  await page.evaluate(() => {
    window.__ebr46Stage = 'approach';
    window.__ebr46Frames = [];
    function record() {
      const { character } = window.__ebr46Test;
      window.__ebr46Frames.push({ stage: window.__ebr46Stage, x: character.position.x, y: character.position.y, z: character.position.z });
      requestAnimationFrame(record);
    }
    requestAnimationFrame(record);
  });

  const click = await page.evaluate(() => {
    const { camera, stairs } = window.__ebr46Test;
    const mesh = stairs.treads.at(-1);
    const point = mesh.getWorldPosition(mesh.position.clone());
    point.y += mesh.geometry.parameters.height / 2;
    camera.updateMatrixWorld();
    point.project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, click), 'scene');
  await page.evaluate(() => { window.__ebr46Stage = 'descent'; });
  await page.mouse.click(click.x, click.y);
  await page.waitForFunction(() => window.__ebr46Test.character.position.x > 12.04, null, { timeout: 20000 });
  await holdUntil(page, ['s', 'd'], () => window.__ebr46Test.character.position.x > 12.095);
  await page.waitForTimeout(100);
  const bottom = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(bottom[0] <= geometry.boxes.at(-1).maxX - 0.4 + 1e-6);
  assert.ok(Math.abs(bottom[1] - geometry.boxes.at(-1).maxY) < 0.01);
  await capture(page, '02-bottom-tread.png');

  await page.evaluate(() => { window.__ebr46Stage = 'side-boundaries'; });
  await holdUntil(page, ['s', 'a'], () => window.__ebr46Test.character.position.z > 0.945);
  const sideA = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(sideA[2] <= geometry.boxes[0].maxZ - 0.4 + 1e-6);
  await holdUntil(page, ['w', 'd'], () => window.__ebr46Test.character.position.z < 0.555);
  const sideB = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(sideB[2] >= geometry.boxes[0].minZ + 0.4 - 1e-6);
  await holdUntil(page, ['s', 'a'], () => window.__ebr46Test.character.position.z > 0.69);

  await page.evaluate(() => { window.__ebr46Stage = 'ascent'; });
  await holdUntil(page, ['w', 'a'], () => window.__ebr46Test.character.position.x < 10.5);
  const middle = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(middle[1] > bottom[1] && middle[1] < 2.4);
  await capture(page, '03-mid-climb.png');
  await holdUntil(page, ['w', 'a'], () => window.__ebr46Test.character.position.x < 7.4);
  const top = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(Math.abs(top[1] - 2.4) < 1e-6);
  await capture(page, '04-returned-to-path.png');

  const frames = await page.evaluate(() => window.__ebr46Frames);
  const descent = frames.filter((frame) => frame.stage === 'descent');
  const ascent = frames.filter((frame) => frame.stage === 'ascent');
  assert.ok(descent.length >= 20 && ascent.length >= 20);
  assert.ok(Math.min(...descent.map((frame) => frame.y)) < 0.6);
  assert.ok(Math.max(...ascent.map((frame) => frame.y)) >= 2.39);
  for (const frame of frames) assertNoClipping(frame, geometry.boxes);

  const night = await context.newPage();
  collectErrors(night, errors);
  await night.goto(`${url}/?phase=night`, { waitUntil: 'networkidle' });
  assert.equal(await night.locator('[data-phase]').textContent(), 'Night');
  await capture(night, '05-night-overview.png');
  assert.deepEqual(errors, []);
  proof = {
    browser: `Chromium ${browser.version()}`, url, viewport: '1280x720', rendering,
    geometry, input: { bottomTreadClick: click, bottom, sideA, sideB, middle, top },
    frames: { total: frames.length, descent: descent.length, ascent: ascent.length, clippedOrUnsupported: 0 },
    errors,
  };
});
