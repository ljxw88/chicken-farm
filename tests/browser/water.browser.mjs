import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
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
});

after(async () => {
  if (evidenceDir) await writeFile(join(evidenceDir, 'browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await server?.close();
});

async function openPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  // Only expose state for projection/measurement; movement and placement use
  // the actual canvas, mouse and keyboard.
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr48Test = { scene, camera, character, obstacles };\n` });
  });
  await page.goto(`${url}/?phase=daytime`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__ebr48Test && window.getPixelRendering?.().canvasWidth));
  return { page, errors };
}

async function capture(page, name) {
  if (!evidenceDir) return;
  await page.screenshot({ path: join(evidenceDir, name) });
  proof.screenshots.push(name);
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

async function walkTo(page, x, z) {
  const point = await worldPoint(page, x, z);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(({ x, z }) => {
    const p = window.__ebr48Test.character.position;
    return Math.hypot(p.x - x, p.z - z) < 0.05;
  }, { x, z }, { timeout: 20000 });
}

test('real clicks cross the provisional bridge; WASD stops at the stream beside it', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const initial = await page.evaluate(() => {
    const { scene, obstacles } = window.__ebr48Test;
    return {
      stream: Boolean(scene.getObjectByName('farm-stream-segment-1')),
      bridge: Boolean(scene.getObjectByName('farm-wooden-bridge')),
      waterfall: Boolean(scene.getObjectByName('farm-waterfall-face')),
      bridgeBlocksWalking: obstacles.find((entry) => entry.name === 'wooden-bridge')?.blocksWalking,
      pixel: window.getPixelRendering(),
    };
  });
  assert.equal(initial.stream && initial.bridge && initial.waterfall, true);
  assert.equal(initial.bridgeBlocksWalking, false);
  assert.equal(initial.pixel.enabled, true);
  await capture(page, '01-placeholder-daytime.png');

  // The waypoints avoid the unchanged pond, buildings and stairs.
  await walkTo(page, 7.2, 0);
  await walkTo(page, 7.1, -3.5);
  await walkTo(page, 7.1, -7.2);
  const crossed = await page.evaluate(() => window.__ebr48Test.character.position.toArray());
  assert.ok(Math.abs(crossed[1] - 2.4) < 1e-6);
  await capture(page, '02-crossed-placeholder-bridge.png');

  await walkTo(page, 5.3, -7.2);
  await page.keyboard.down('s');
  await page.keyboard.down('a'); // World +Z, toward water away from the bridge.
  try {
    await page.waitForFunction(() => window.__ebr48Test.character.position.z > -6.7, null, { timeout: 10000 });
    await page.waitForTimeout(600);
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('a');
  }
  const stopped = await page.evaluate(() => window.__ebr48Test.character.position.toArray());
  assert.ok(stopped[2] < -5.95, `water was crossed: ${stopped}`);
  await capture(page, '03-stream-stops-walking.png');
  assert.deepEqual(errors, []);
  proof.walking = { initial, crossed, stopped, errors };
});

test('real fence and plot previews reject stream and dry bridge-overhang tiles', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const checks = [];
  for (const kind of ['fence', 'plot']) {
    await page.keyboard.press(kind === 'fence' ? 'f' : 'p');
    let point = await worldPoint(page, 5.25, -6.75); // Partial overlap with stream water.
    await page.mouse.move(point.x, point.y);
    assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
    assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
    await page.mouse.click(point.x, point.y);
    checks.push(`${kind}: water`);

    if (kind === 'plot') await page.keyboard.press('r'); // Keep both plot tiles inside the island.
    point = await worldPoint(page, 6.75, -3.75); // Dry bridge overhang; no stream/pond in this tile.
    await page.mouse.move(point.x, point.y);
    assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
    assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
    assert.equal(await page.evaluate(() => window.__ebr48Test.scene.getObjectByName('placement-wash').material.color.getHex()), 0xc45a3a);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate((name) => window.__ebr48Test.scene.getObjectsByProperty('name', `placed-${name}`).length, kind), 0);
    checks.push(`${kind}: dry bridge overhang`);
  }
  await capture(page, '04-bridge-tile-rejected.png');
  assert.deepEqual(errors, []);
  proof.placement = { checks, errors };
});
