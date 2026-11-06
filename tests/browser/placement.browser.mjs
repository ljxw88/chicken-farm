import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const evidenceDir = process.env.EBR56_EVIDENCE_DIR;
const proof = { screenshots: [], checks: [] };
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
  if (process.env.EBR56_DEV_URL) {
    devUrl = process.env.EBR56_DEV_URL.replace(/\/$/, '');
  } else {
    devServer = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
    await devServer.listen();
    devUrl = serverUrl(devServer.httpServer);
  }
  previewServer = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  previewUrl = serverUrl(previewServer.httpServer);
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  proof.browser = `Chromium ${browser.version()} (headless, SwiftShader)`;
  proof.devUrl = devUrl;
  proof.previewUrl = previewUrl;
});

after(async () => {
  if (evidenceDir) {
    await writeFile(join(evidenceDir, 'browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
    const log = [
      'EBR-56 browser evidence',
      `Browser: ${proof.browser ?? 'not started'}`,
      `Vite dev server: ${proof.devUrl ?? 'not started'}`,
      `Production preview: ${proof.previewUrl ?? 'not started'}`,
      ...proof.checks.map((check) => `- ${check}`),
      `Screenshots: ${proof.screenshots.join(', ') || 'none'}`,
      'The touch check uses Chromium emulation, not a physical device.',
    ];
    await writeFile(join(evidenceDir, 'browser-log.txt'), `${log.join('\n')}\n`);
  }
  await browser?.close();
  await devServer?.close();
  if (previewServer) await new Promise((resolve) => previewServer.httpServer.close(resolve));
});

async function openPage(context, url, instrument = false) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  if (instrument) {
    // Test-only access for projecting points and inspecting the live scene. No
    // test hooks, teleportation, or synthetic placement calls are in the app.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = `${await response.text()}\nwindow.__ebr56Test = { scene, camera, character, obstacles, stairs };\n`;
      await route.fulfill({ response, body });
    });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  if (instrument) await page.waitForFunction(() => Boolean(window.__ebr56Test));
  await page.waitForFunction(() => Boolean(window.getPixelRendering?.().canvasWidth));
  return { page, errors };
}

async function assertNoSimUi(page) {
  const forbidden = [
    '.farm-supplies', '.farm-growing', '.farm-inventory', '.farm-market', '.farm-build',
    '.interaction-prompt', '.interaction-feedback', '[data-collect]', '[data-sell-egg]',
    '[data-buy-feed]', '[data-place-fence]', '[data-build-toggle]',
  ];
  assert.equal(await page.locator(forbidden.join(',')).count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /\b(inventory|collect|egg|feed|supplies|buy|sell|market|build)\b/i);
  assert.equal(await page.locator('[data-fence]').isVisible(), true);
  assert.equal(await page.locator('[data-plot]').isVisible(), true);
}

async function capture(page, name) {
  if (!evidenceDir) return;
  await page.screenshot({ path: join(evidenceDir, name) });
  proof.screenshots.push(name);
}

async function worldPoint(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__ebr56Test;
    camera.updateMatrixWorld();
    const point = character.position.clone().set(x, character.position.y, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, { x, z });
}

async function moveWorld(page, x, z) {
  const point = await worldPoint(page, x, z);
  await page.mouse.move(point.x, point.y);
  return point;
}

async function count(page, name) {
  return page.evaluate((name) => window.__ebr56Test.scene.getObjectByName('placement-layer').children.filter((child) => child.name === name).length, name);
}

async function position(page) {
  return page.evaluate(() => window.__ebr56Test.character.position.toArray());
}

test('production build: a fence is free, undoable, and rendered through the default pixel pass', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${previewUrl}/?phase=daytime`);
  await assertNoSimUi(page);
  await page.keyboard.press('f');
  // An open patch makes the untinted wood silhouette easy to inspect.
  const target = { x: 449, y: 381 };
  await page.mouse.move(target.x, target.y);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  const pixel = await page.evaluate(() => window.getPixelRendering());
  assert.equal(pixel.enabled, true);
  assert.deepEqual([pixel.canvasWidth, pixel.canvasHeight, pixel.cssPixelSize], [320, 180, 4]);
  await capture(page, '01-production-valid-fence.png');
  await page.mouse.click(target.x, target.y);
  assert.match(await page.locator('.placement-status').textContent(), /Space already occupied/);
  const removeButton = await page.locator('[data-remove]').boundingBox();
  await page.mouse.move(removeButton.x + removeButton.width / 2, removeButton.y + removeButton.height / 2, { steps: 30 });
  assert.equal(await page.locator('[data-remove]').isEnabled(), true);
  await page.locator('[data-remove]').click();
  assert.equal(await page.locator('[data-remove]').getAttribute('aria-pressed'), 'true');
  await page.mouse.move(target.x, target.y);
  assert.match(await page.locator('.placement-status').textContent(), /highlighted tile/);
  await capture(page, '01a-remove-target.png');
  await page.mouse.click(target.x, target.y);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await page.mouse.click(target.x, target.y);
  assert.match(await page.locator('.placement-status').textContent(), /Space already occupied/);
  await page.keyboard.press('z');
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.placement-detail').isVisible(), false);
  assert.deepEqual(errors, []);
  await assertNoSimUi(page);
  proof.production = { pixel, strippedUi: true, mouseRemove: true, undoRestoredTile: true, errors };
  proof.checks.push('Production preview: free fence, mouse-targeted Remove, undo and cancel work without simulation UI; pixel canvas is 320×180 at 1280×720.');
});

test('dev: valid and invalid previews, rotations, two kinds, collisions, undo and targeted removal', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  await assertNoSimUi(page);
  const initial = await page.evaluate(() => ({
    obstacles: window.__ebr56Test.obstacles.length,
    gridVisible: window.__ebr56Test.scene.getObjectByName('placement-debug-grid').visible,
    pixel: window.getPixelRendering(),
  }));
  assert.equal(initial.gridVisible, false);
  assert.equal(initial.obstacles, 8);
  await page.keyboard.press('f');

  await moveWorld(page, -0.75, -0.75);
  assert.match(await page.locator('.placement-status').textContent(), /Move away/);
  const invalid = await page.evaluate(() => {
    const { scene } = window.__ebr56Test;
    const ghost = scene.getObjectByName('placement-ghost');
    const wash = scene.getObjectByName('placement-wash');
    return { color: wash.material.color.getHex(), opacity: wash.material.opacity, ghostOpacity: ghost.children[0].material.opacity,
      woodColors: ghost.children.map((part) => part.material.color.getHex()) };
  });
  assert.deepEqual(invalid, { color: 0xc45a3a, opacity: 0.5, ghostOpacity: 0.5,
    woodColors: [0x8b6914, 0x8b6914, 0xd4a574, 0xd4a574] });

  await moveWorld(page, 7.8, 3.75);
  assert.match(await page.locator('.placement-status').textContent(), /Outside the buildable island/);
  await capture(page, '02-invalid-rust.png');
  await moveWorld(page, 4, -3.5);
  assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
  await moveWorld(page, 1.75, 1.75);
  assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
  const chickenPoint = await worldPoint(page, 1.75, 1.75);
  await page.mouse.click(chickenPoint.x, chickenPoint.y);
  assert.equal(await count(page, 'placed-fence'), 0);
  await assertNoSimUi(page);

  const fencePoint = await moveWorld(page, -0.75, 3.75);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  const valid = await page.evaluate(() => {
    const { scene } = window.__ebr56Test;
    const ghost = scene.getObjectByName('placement-ghost');
    const wash = scene.getObjectByName('placement-wash');
    return { color: wash.material.color.getHex(), opacity: wash.material.opacity, ghostOpacity: ghost.children[0].material.opacity,
      y: ghost.position.y, woodColors: ghost.children.map((part) => part.material.color.getHex()) };
  });
  assert.deepEqual(valid, { color: 0x283724, opacity: 0.5, ghostOpacity: 0.5, y: 2.48,
    woodColors: [0x8b6914, 0x8b6914, 0xd4a574, 0xd4a574] });
  await page.keyboard.press('r');
  assert.equal(await page.evaluate(() => window.__ebr56Test.scene.getObjectByName('placement-ghost').rotation.y), Math.PI / 2);
  await capture(page, '03-rotated-fence-preview.png');
  await page.keyboard.press('r');
  await page.mouse.click(fencePoint.x, fencePoint.y);
  assert.equal(await count(page, 'placed-fence'), 1);
  assert.equal(await page.evaluate(() => window.__ebr56Test.obstacles.length), 9);
  assert.equal(await page.evaluate(() => window.__ebr56Test.scene.getObjectByName('placed-fence').rotation.y), Math.PI);
  assert.deepEqual(await position(page), [0, 2.4, 0]);
  assert.match(await page.locator('.placement-status').textContent(), /Space already occupied/);
  await capture(page, '04-placed-fence-occupied.png');

  await page.keyboard.press('p');
  assert.equal(await page.locator('[data-plot]').getAttribute('aria-pressed'), 'true');
  const plotPoint = await moveWorld(page, -3.75, 3.75);
  await page.keyboard.press('r');
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await capture(page, '05-rotated-plot-preview.png');
  await page.mouse.click(plotPoint.x, plotPoint.y);
  assert.equal(await count(page, 'placed-plot'), 1);
  assert.equal(await page.evaluate(() => window.__ebr56Test.obstacles.length), 9);
  assert.deepEqual(await page.evaluate(() => window.__ebr56Test.scene.getObjectByName('placed-plot').children.map((part) => part.material.color.getHex())),
    [0x7a5a3a, 0xa67c52, 0x7a5a3a, 0x7a5a3a, 0x7a5a3a]);
  await page.keyboard.press('Escape');
  await capture(page, '06-fence-and-plot.png');
  await moveWorld(page, -0.75, 3.75);
  await page.evaluate(() => window.addEventListener('keydown', (event) => {
    if (event.code === 'Delete') window.__ebr56DeletePrevented = event.defaultPrevented;
  }, { once: true }));
  await page.keyboard.press('Delete'); // Delete without an active tool stays a no-op.
  assert.equal(await page.evaluate(() => window.__ebr56DeletePrevented), false);
  assert.equal(await count(page, 'placed-fence'), 1);
  assert.equal(await count(page, 'placed-plot'), 1);
  await page.keyboard.press('z');
  assert.equal(await count(page, 'placed-plot'), 0);
  assert.equal(await count(page, 'placed-fence'), 1);

  // S+A is world +Z. The fence spans that route.
  await page.keyboard.down('s');
  await page.keyboard.down('a');
  try {
    await page.waitForFunction(() => window.__ebr56Test.character.position.z > 3, null, { timeout: 10000 });
    await page.waitForTimeout(650);
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('a');
  }
  const blocked = await position(page);
  assert.ok(blocked[2] > 3 && blocked[2] < 3.3, `walk crossed fence: ${blocked}`);
  await capture(page, '07-walk-blocked.png');

  await page.keyboard.press('f');
  await moveWorld(page, -0.75, 3.75);
  assert.equal(await page.locator('[data-remove]').isEnabled(), true);
  await page.keyboard.press('Delete');
  assert.equal(await count(page, 'placed-fence'), 0);
  assert.equal(await page.evaluate(() => window.__ebr56Test.obstacles.length), 8);
  await page.keyboard.press('Escape');
  await page.keyboard.down('s');
  await page.keyboard.down('a');
  try {
    await page.waitForFunction(() => window.__ebr56Test.character.position.z > 4.2, null, { timeout: 10000 });
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('a');
  }
  const afterRemoval = await position(page);
  assert.ok(afterRemoval[2] > blocked[2] + 0.9);
  await capture(page, '08-walk-after-removal.png');
  assert.deepEqual(errors, []);
  proof.dev = { initial, valid, invalid, blocked, afterRemoval, fenceRotated: true, plotRotated: true, errors };
  proof.checks.push('Dev: olive/rust 50% footprint washes; fence rails keep original wood hues; player, pond, chicken, edge and occupied tiles reject placement.');
  proof.checks.push('Dev: rotate/place a fence and a two-tile plot for free; undo the plot; Delete removes the hovered fence.');
  proof.checks.push(`Dev WASD: fence stopped +Z at ${blocked[2].toFixed(2)}; after removal walking reached ${afterRemoval[2].toFixed(2)}. No page/console errors.`);
});

test('a placed plot can be crossed by WASD and removed from its footprint', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  await assertNoSimUi(page);
  await page.keyboard.press('p');
  const plotPoint = await moveWorld(page, -0.75, 3.75);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await page.mouse.click(plotPoint.x, plotPoint.y);
  assert.equal(await count(page, 'placed-plot'), 1);
  assert.equal(await page.evaluate(() => window.__ebr56Test.obstacles.length), 8);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.__ebr56WalkFrames = [];
    function record() {
      const p = window.__ebr56Test.character.position;
      window.__ebr56WalkFrames.push([p.x, p.y, p.z]);
      requestAnimationFrame(record);
    }
    requestAnimationFrame(record);
  });
  // The dirt spans z=3..4.5. S+A travels across it in world +Z.
  await page.keyboard.down('s');
  await page.keyboard.down('a');
  try {
    await page.waitForFunction(() => window.__ebr56Test.character.position.z > 5, null, { timeout: 15000 });
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('a');
  }
  const end = await position(page);
  const frames = await page.evaluate(() => window.__ebr56WalkFrames);
  assert.ok(frames.some(([x, y, z]) => Math.abs(x) < 0.1 && Math.abs(y - 2.4) < 1e-6 && z > 3.2 && z < 4.3));
  await capture(page, '13-plot-walkable.png');
  await page.keyboard.press('p');
  await moveWorld(page, -0.75, 3.75);
  await page.keyboard.press('Delete');
  assert.equal(await count(page, 'placed-plot'), 0);
  assert.equal(await page.evaluate(() => window.__ebr56Test.obstacles.length), 8);
  assert.deepEqual(errors, []);
  proof.plotWalk = { end, sampledFrames: frames.length, walkedOverDirt: true, removedWithDelete: true, errors };
  proof.checks.push(`Dev WASD: crossed a placed plot to z=${end[2].toFixed(2)} and removed the plot with Delete; it added no walking obstacle.`);
});

test('the foot pad and corner slide remain climbable with a fence and plot placed', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  await page.keyboard.press('f');
  const fencePoint = await moveWorld(page, -3.75, 3.75);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await page.mouse.click(fencePoint.x, fencePoint.y);
  await page.keyboard.press('p');
  const plotPoint = await moveWorld(page, -5.25, 5.25);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await page.mouse.click(plotPoint.x, plotPoint.y);
  assert.equal(await count(page, 'placed-fence'), 1);
  assert.equal(await count(page, 'placed-plot'), 1);
  await page.keyboard.press('Escape');

  const pad = await page.evaluate(() => {
    const { camera, character, stairs } = window.__ebr56Test;
    const mesh = stairs.footPad;
    const p = mesh.getWorldPosition(character.position.clone());
    const world = { x: p.x, z: p.z };
    p.y += mesh.geometry.parameters.height / 2;
    camera.updateMatrixWorld();
    p.project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { world, x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  });
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, pad), 'scene');
  await page.mouse.click(pad.x, pad.y);
  await page.waitForFunction(({ x, z }) => {
    const p = window.__ebr56Test.character.position;
    return Math.hypot(p.x - x, p.z - z) < 0.04;
  }, pad.world, { timeout: 20000 });
  // At the pad centre the capsule still touches the last tread's upper edge.
  await page.keyboard.down('s');
  await page.keyboard.down('d');
  try {
    await page.waitForFunction(() => window.__ebr56Test.character.position.x > window.__ebr56Test.stairs.bounds.maxX - 0.41,
      null, { timeout: 10000 });
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('d');
  }
  const bottom = await position(page);
  assert.ok(Math.abs(bottom[1] - 0.16) < 0.01);
  await page.keyboard.down('s');
  await page.keyboard.down('a');
  try {
    await page.waitForFunction(() => window.__ebr56Test.character.position.z > 1.145, null, { timeout: 10000 });
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('a');
  }
  const padSide = await position(page);
  await page.keyboard.down('w');
  await page.keyboard.down('a');
  try {
    await page.waitForFunction(() => window.__ebr56Test.character.position.x < 7.4, null, { timeout: 20000 });
  } finally {
    await page.keyboard.up('w');
    await page.keyboard.up('a');
  }
  const top = await position(page);
  assert.ok(Math.abs(top[1] - 2.4) < 1e-6);
  assert.equal(await count(page, 'placed-fence'), 1);
  assert.equal(await count(page, 'placed-plot'), 1);
  await capture(page, '14-stairs-after-placement.png');
  await assertNoSimUi(page);
  assert.deepEqual(errors, []);
  proof.stairs = { padClick: pad, bottom, padSide, top, placedFence: true, placedPlot: true, errors };
  proof.checks.push('Dev: clicked the foot pad, pushed to its side and climbed back to the island with a fence and plot still placed.');
});

test('the opt-in debug grid is a dirt-coloured hairline, not the default', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime&grid=1`, true);
  await assertNoSimUi(page);
  const state = await page.evaluate(() => {
    const grid = window.__ebr56Test.scene.getObjectByName('placement-debug-grid');
    return { visible: grid.visible, color: grid.material.color.getHex(), linewidth: grid.material.linewidth, pixel: window.getPixelRendering().enabled };
  });
  assert.deepEqual(state, { visible: true, color: 0xa67c52, linewidth: 1, pixel: true });
  await capture(page, '09-debug-grid.png');
  assert.deepEqual(errors, []);
  proof.grid = { ...state, errors };
  proof.checks.push('Dev ?grid=1: visible 1-pixel-line material #A67C52; default grid is off.');
});

test('touch emulation previews first, rotates and confirms with the direct controls', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  await assertNoSimUi(page);
  await page.locator('[data-fence]').tap();
  const point = await worldPoint(page, 0.75, -3.75);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  await page.touchscreen.tap(point.x, point.y);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  assert.equal(await count(page, 'placed-fence'), 0);
  await capture(page, '10-touch-preview.png');
  await page.locator('[data-rotate]').tap();
  assert.equal(await page.evaluate(() => window.__ebr56Test.scene.getObjectByName('placement-ghost').rotation.y), Math.PI / 2);
  await page.locator('[data-confirm]').tap();
  assert.equal(await count(page, 'placed-fence'), 1);
  await capture(page, '11-touch-placed.png');
  await page.locator('[data-remove]').tap();
  await page.touchscreen.tap(point.x, point.y);
  assert.equal(await count(page, 'placed-fence'), 0);
  assert.equal(await page.evaluate(() => window.__ebr56Test.obstacles.length), 8);
  assert.deepEqual(errors, []);
  proof.touch = { viewport: '1280×720', previewBeforeConfirm: true, rotated: true, removed: true, errors };
  proof.checks.push('1280×720 touch emulation: tap previews, Rotate changes only ghost, Place confirms and Remove deletes without simulation UI.');
});

test('portrait touch can place and remove without the old HUD', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  await assertNoSimUi(page);
  await page.locator('[data-fence]').tap();
  const point = await worldPoint(page, 0.75, -3.75);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  await page.touchscreen.tap(point.x, point.y);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await capture(page, '15-touch-portrait-preview.png');
  await page.locator('[data-confirm]').tap();
  assert.equal(await count(page, 'placed-fence'), 1);
  await page.locator('[data-remove]').tap();
  await page.touchscreen.tap(point.x, point.y);
  assert.equal(await count(page, 'placed-fence'), 0);
  assert.deepEqual(errors, []);
  proof.touchPortrait = { viewport: '390×844', placed: true, removed: true, errors };
  proof.checks.push('390×844 touch emulation: preview, Place and Remove work without the old HUD.');
});

test('direct controls remain visible and clickable without the old HUD on small screens', { timeout: 90000 }, async () => {
  const sizes = [[320, 568, true], [390, 844, true], [844, 390, false], [568, 320, false], [480, 320, false]];
  for (const [width, height, touch] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: touch, hasTouch: touch });
    try {
      const { page, errors } = await openPage(context, `${previewUrl}/?phase=daytime`);
      const activate = (selector) => touch ? page.locator(selector).tap() : page.locator(selector).click();
      await assertNoSimUi(page);
      await activate('[data-fence]');
      assert.equal(await page.locator('[data-fence]').getAttribute('aria-pressed'), 'true');
      await activate('[data-rotate]');
      if (width === 480) await capture(page, '12-short-landscape-controls.png');
      await activate('[data-cancel]');
      await activate('[data-plot]');
      assert.equal(await page.locator('[data-plot]').getAttribute('aria-pressed'), 'true');
      await activate('[data-cancel]');
      await assertNoSimUi(page);
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  proof.checks.push('320×568, 390×844, 844×390, 568×320 and 480×320: direct placement controls remain visible and clickable without the removed HUD.');
});
