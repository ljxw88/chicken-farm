import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const evidenceDir = process.env.EBR36_EVIDENCE_DIR;
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
  devServer = await createServer({
    configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await devServer.listen();
  devUrl = serverUrl(devServer.httpServer);
  previewServer = await preview({
    configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 },
  });
  previewUrl = serverUrl(previewServer.httpServer);
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  if (evidenceDir) await writeFile(join(evidenceDir, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
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
    // Test-only exposure of the real scene and cycle; the shipped app has no debug HUD globals.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = `${await response.text()}\nwindow.__ebr36Test = { scene, camera, character, dayNight };\n`;
      await route.fulfill({ response, body });
    });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  if (instrument) await page.waitForFunction(() => Boolean(window.__ebr36Test));
  return { page, errors };
}

async function capture(page, name) {
  if (evidenceDir) await page.screenshot({ path: join(evidenceDir, name) });
}

async function farmState(page) {
  return page.evaluate(() => ({
    cycle: window.__ebr36Test.dayNight.getState(),
    sky: window.__ebr36Test.scene.background.getHex(),
    position: window.__ebr36Test.character.position.toArray(),
  }));
}

async function canvasPointFor(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__ebr36Test;
    camera.updateMatrixWorld();
    const point = character.position.clone().set(x, 0, z).project(camera);
    return { x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2 };
  }, { x, z });
}

async function assertArrived(page, x, z) {
  await page.waitForFunction(({ x, z }) => {
    const position = window.__ebr36Test.character.position;
    return Math.hypot(position.x - x, position.z - z) < 0.1;
  }, { x, z }, { timeout: 6000 });
}

test('desktop HUD controls the real cycle, keeps focus and preserves walking', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1260, height: 1080 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  const panel = page.locator('#sky-panel');
  const skyButton = page.locator('[data-action="sky"]');
  const follow = page.getByRole('switch', { name: 'Follow the day' });
  const previous = page.getByRole('button', { name: 'Previous time of day' });
  const next = page.getByRole('button', { name: 'Next time of day' });

  assert.equal(await page.getByRole('heading', { name: 'A changing sky' }).count(), 1);
  assert.equal(await page.locator('.hud-panel__footer').textContent(), 'One farm day lasts 24 minutes');
  assert.equal(await follow.getAttribute('aria-checked'), 'true');
  assert.equal((await farmState(page)).cycle.cycleSeconds, 1440);
  assert.equal(await page.getByRole('button', { name: 'Previous weather' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Next weather' }).isDisabled(), true);
  assert.equal(await page.getByRole('switch', { name: 'Let it change' }).isDisabled(), true);
  assert.match(await page.locator('#weather-hint').textContent(), /EBR-35/);
  assert.equal(await page.getByRole('button', { name: 'Sound unavailable' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'More options unavailable' }).isDisabled(), true);

  const box = await panel.boundingBox();
  const toolbarBox = await page.locator('.hud-toolbar').boundingBox();
  const columns = await page.locator('.hud-column').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  assert.ok(Math.abs(box.x + box.width / 2 - 630) < 1);
  assert.ok(box.y > 1080 / 2 && box.y + box.height < toolbarBox.y);
  assert.ok(Math.abs(columns[0] - columns[1]) < 1);
  assert.equal(await page.locator('#hud').evaluate((element) => element.closest('canvas')), null);
  assert.equal(await page.locator('#hud').evaluate((element) => getComputedStyle(element).imageRendering), 'auto');
  await capture(page, 'desktop-1260x1080.png');
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Close sky settings', exact: true }).evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await previous.evaluate((element) => element === document.activeElement), true);

  const beforeClick = await farmState(page);
  await next.click();
  await page.waitForTimeout(250);
  let current = await farmState(page);
  assert.equal(await follow.getAttribute('aria-checked'), 'false');
  assert.equal(current.cycle.phase, 'daytime');
  assert.equal(current.cycle.progress, 0.25);
  assert.equal(current.sky, 0xa8d4f0);
  assert.deepEqual(current.position, beforeClick.position); // HUD pointer input never sets a ground target.
  await page.waitForTimeout(250);
  assert.equal((await farmState(page)).cycle.progress, current.cycle.progress);

  for (const [phase, color] of [['sunset', 0xf0a878], ['night', 0x2a2848], ['morning', 0xe8d4c8]]) {
    await next.click();
    current = await farmState(page);
    assert.equal(current.cycle.phase, phase);
    assert.equal(current.sky, color);
    assert.equal(await skyButton.getAttribute('data-phase'), phase);
    if (phase === 'night') {
      assert.match(await skyButton.locator('path').first().getAttribute('d'), /^M19\.2/);
      await capture(page, 'desktop-night.png');
    }
  }
  await previous.click();
  assert.equal((await farmState(page)).cycle.phase, 'night');
  await next.click();
  assert.equal((await farmState(page)).cycle.phase, 'morning');

  // Resume immediately after a suspended frame: paused time must not advance the cycle.
  await page.evaluate(() => { window.setDayNightCycleSeconds(8); window.setDayNightPhase('sunset'); });
  await page.waitForFunction(() => document.querySelector('[data-action="sky"]').dataset.phase === 'sunset');
  const resumedAfterStall = await page.evaluate(async () => {
    const start = performance.now();
    while (performance.now() - start < 1000) { /* Simulate a suspended render loop. */ }
    const resumedAt = performance.now();
    document.querySelector('button[aria-labelledby="follow-day-label"]').click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { cycle: window.__ebr36Test.dayNight.getState(), elapsed: (performance.now() - resumedAt) / 1000 };
  });
  assert.equal(resumedAfterStall.cycle.following, true);
  assert.ok(resumedAfterStall.cycle.progress - 0.5 <= resumedAfterStall.elapsed / 8 + 0.02, JSON.stringify(resumedAfterStall));
  await follow.click();

  // A developer speed override changes the truthful footer, and running state drives the toolbar.
  await page.evaluate(() => { window.setDayNightCycleSeconds(4); window.setDayNightPhase('sunset'); });
  await page.waitForFunction(() => document.querySelector('[data-action="sky"]').dataset.phase === 'sunset');
  await page.waitForFunction(() => document.querySelector('.hud-panel__footer').textContent === 'One farm day lasts 4 seconds');
  await follow.focus();
  await page.keyboard.press('Space');
  assert.equal(await follow.getAttribute('aria-checked'), 'true');
  await page.waitForFunction(() => document.querySelector('[data-action="sky"]').dataset.phase === 'night', null, { timeout: 4000 });
  assert.equal((await farmState(page)).cycle.phase, 'night');
  await follow.click();
  assert.equal(await follow.getAttribute('aria-checked'), 'false');

  const fullscreen = page.locator('[data-action="fullscreen"]');
  if (!await fullscreen.isDisabled()) {
    await fullscreen.click();
    await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
    assert.equal(await fullscreen.getAttribute('aria-label'), 'Exit fullscreen');
    await fullscreen.click();
    await page.waitForFunction(() => !document.fullscreenElement);
    proof.fullscreen = 'entered and exited browser fullscreen';
  } else {
    assert.equal(await fullscreen.getAttribute('aria-label'), 'Fullscreen unavailable');
    proof.fullscreen = 'unavailable and disabled in this browser';
  }

  // A focused HUD button must not swallow WASD or lose its own keyboard focus.
  await next.focus();
  const beforeWalk = await farmState(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(450);
  await page.keyboard.up('w');
  const afterWalk = await farmState(page);
  assert.ok(Math.hypot(afterWalk.position[0] - beforeWalk.position[0], afterWalk.position[2] - beforeWalk.position[2]) > 0.3);
  assert.equal(await next.evaluate((element) => element === document.activeElement), true);

  // Put the unobstructed ground target above the panel regardless of the walking frame rate.
  await page.evaluate(async () => {
    window.__ebr36Test.character.position.set(0, 0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const openPanelPoint = await canvasPointFor(page, -0.75, -1.1);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, openPanelPoint), 'scene');
  await page.mouse.click(openPanelPoint.x, openPanelPoint.y);
  await assertArrived(page, -0.75, -1.1);

  await page.getByRole('button', { name: 'Close sky settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await panel.isHidden(), true);
  assert.equal(await skyButton.getAttribute('aria-expanded'), 'false');
  assert.equal(await skyButton.evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), true);
  await next.focus();
  await page.keyboard.press('Escape');
  assert.equal(await panel.isHidden(), true);

  const point = await canvasPointFor(page, 0.85, -0.2);
  await page.mouse.click(point.x, point.y);
  await assertArrived(page, 0.85, -0.2);
  await capture(page, 'desktop-closed.png');
  assert.deepEqual(errors, []);
  proof.desktop = { viewport: '1260x1080', panel: box, toolbar: toolbarBox, columnWidths: columns, resumedAfterStall, walkedFrom: beforeWalk.position, walkedTo: afterWalk.position, openPanelClickTarget: [-0.75, -1.1], closedPanelClickTarget: [0.85, -0.2], errors };
});

test('WASD still collides with the barn while a HUD control has focus', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1260, height: 1080 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  await page.evaluate(() => window.__ebr36Test.character.position.set(-3.4, 0, -0.8));
  await page.getByRole('button', { name: 'Next time of day' }).focus();
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await page.waitForFunction(() => window.__ebr36Test.character.position.z < -1.55, null, { timeout: 5000 });
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  const position = (await farmState(page)).position;
  assert.ok(position[2] >= -1.700001 && position[2] < -1.6);
  assert.deepEqual(errors, []);
  proof.barnCollision = { position, expectedFrontLimit: -1.7, errors };
});

test('mobile touch, narrow labels and landscape scrolling remain usable', { timeout: 90000 }, async (t) => {
  const summaries = [];
  for (const [width, height] of [[390, 844], [320, 568]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    t.after(() => context.close());
    const { page, errors } = await openPage(context, devUrl, true);
    const panel = page.locator('#sky-panel');
    const panelBox = await panel.boundingBox();
    const toolbarBox = await page.locator('.hud-toolbar').boundingBox();
    assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= width);
    assert.ok(panelBox.y >= 0 && panelBox.y + panelBox.height < toolbarBox.y);
    const columns = await page.locator('.hud-column').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    assert.ok(Math.abs(columns[0] - columns[1]) < 1);
    const labelSizes = await page.locator('.hud-selector__value').evaluateAll((elements) => elements.map((element) => ({ client: element.clientWidth, scroll: element.scrollWidth })));
    assert.ok(labelSizes.every(({ client, scroll }) => scroll <= client));
    const next = page.getByRole('button', { name: 'Next time of day' });
    const target = await next.boundingBox();
    assert.ok(target.width >= 44 && target.height >= 44);
    await capture(page, `mobile-${width}x${height}.png`);

    await next.tap();
    assert.equal((await farmState(page)).cycle.phase, 'daytime');
    assert.equal(await page.getByRole('switch', { name: 'Follow the day' }).getAttribute('aria-checked'), 'false');
    const daytimeSizes = await page.locator('.hud-selector__value').evaluateAll((elements) => elements.map((element) => ({ client: element.clientWidth, scroll: element.scrollWidth })));
    assert.ok(daytimeSizes.every(({ client, scroll }) => scroll <= client));
    await page.getByRole('button', { name: 'Close sky settings', exact: true }).tap();
    assert.equal(await panel.isHidden(), true);
    await page.locator('[data-action="sky"]').tap();
    assert.equal(await panel.isVisible(), true);
    await page.getByRole('button', { name: 'Close sky settings', exact: true }).tap();

    const point = await canvasPointFor(page, 0.85, -0.2);
    await page.touchscreen.tap(point.x, point.y);
    await assertArrived(page, 0.85, -0.2);
    assert.deepEqual(errors, []);
    summaries.push({ viewport: `${width}x${height}`, panel: panelBox, toolbar: toolbarBox, columnWidths: columns, labelSizes, touchTarget: [0.85, -0.2], errors });
  }

  const landscape = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  t.after(() => landscape.close());
  const { page, errors } = await openPage(landscape, devUrl, true);
  const panel = page.locator('#sky-panel');
  const dimensions = await panel.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    bottom: element.getBoundingClientRect().bottom,
    height: element.clientHeight,
    contentHeight: element.scrollHeight,
  }));
  assert.ok(dimensions.top >= 0 && dimensions.bottom <= 390);
  assert.ok(dimensions.contentHeight > dimensions.height);
  await page.getByRole('switch', { name: 'Follow the day' }).tap();
  assert.equal(await page.getByRole('switch', { name: 'Follow the day' }).getAttribute('aria-checked'), 'false');
  await page.locator('.hud-panel__footer').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.hud-panel__footer').textContent(), 'One farm day lasts 24 minutes');
  await capture(page, 'mobile-landscape-844x390.png');
  assert.deepEqual(errors, []);
  proof.mobile = { portraits: summaries, landscape: dimensions, errors };
});

test('an injected weather adapter exposes only the capabilities it actually supplies', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1260, height: 1080 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  await page.evaluate(async () => {
    const { createSkyHud } = await import('/src/ui/createSkyHud.ts');
    document.querySelector('#hud').remove();
    const root = document.createElement('div');
    root.className = 'hud-root';
    document.body.append(root);
    const cycle = window.__ebr36Test.dayNight;
    const state = { label: 'Condition A', automatic: undefined };
    const calls = [];
    const weather = {
      status: 'ready',
      getState: () => ({ ...state }),
      next: () => { calls.push('next'); state.label = 'Condition B'; },
    };
    const hud = createSkyHud({
      root,
      dayNight: {
        phases: ['morning', 'daytime', 'sunset', 'night'],
        getState: cycle.getState,
        setPhase: cycle.setDayNightPhase,
        setFollowing: cycle.setFollowing,
      },
      weather,
    });
    window.__weatherAdapterTest = { state, calls, weather, hud };
  });
  assert.equal(await page.getByRole('button', { name: 'Previous weather' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Next weather' }).isDisabled(), false);
  assert.equal(await page.getByRole('switch', { name: 'Let it change' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Next weather' }).click();
  assert.equal(await page.locator('.hud-column').nth(1).locator('.hud-selector__value').textContent(), 'Condition B');
  assert.deepEqual(await page.evaluate(() => window.__weatherAdapterTest.calls), ['next']);
  await page.evaluate(() => {
    const test = window.__weatherAdapterTest;
    test.state.automatic = false;
    test.weather.setAutomatic = (value) => { test.calls.push(`automatic:${value}`); test.state.automatic = value; };
    test.hud.update();
  });
  const automatic = page.getByRole('switch', { name: 'Let it change' });
  assert.equal(await automatic.isDisabled(), false);
  await automatic.click();
  assert.equal(await automatic.getAttribute('aria-checked'), 'true');
  assert.deepEqual(await page.evaluate(() => window.__weatherAdapterTest.calls), ['next', 'automatic:true']);
  assert.deepEqual(errors, []);
  proof.adapterContract = 'mock capabilities and authoritative state reflected; no weather implementation shipped';
});

test('the uninstrumented production build renders and responds', { timeout: 20000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1260, height: 1080 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, previewUrl);
  assert.equal(await page.evaluate(() => '__ebr36Test' in window), false);
  assert.equal(await page.locator('#scene').evaluate((canvas) => Boolean(canvas.getContext('webgl2'))), true);
  assert.equal(await page.locator('.hud-panel__footer').textContent(), 'One farm day lasts 24 minutes');
  await page.getByRole('button', { name: 'Next time of day' }).click();
  assert.equal(await page.locator('[data-action="sky"]').getAttribute('data-phase'), 'daytime');
  assert.equal(await page.getByRole('switch', { name: 'Follow the day' }).getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByRole('switch', { name: 'Let it change' }).isDisabled(), true);
  await capture(page, 'production-daytime.png');
  assert.deepEqual(errors, []);
  proof.production = { webgl2: true, phase: 'daytime', errors };
});

test('a refused fullscreen request reports unavailability instead of pretending to enter', { timeout: 20000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1260, height: 1080 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => true });
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true, value: () => Promise.reject(new Error('Fullscreen denied')),
    });
  });
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  const fullscreen = page.locator('[data-action="fullscreen"]');
  assert.equal(await fullscreen.isDisabled(), false);
  await fullscreen.click();
  await page.getByRole('status').waitFor({ state: 'visible' });
  assert.equal(await fullscreen.isDisabled(), true);
  assert.equal(await fullscreen.getAttribute('aria-label'), 'Fullscreen unavailable');
  assert.equal(await page.getByRole('status').textContent(), 'Fullscreen is unavailable in this browser.');
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
  assert.deepEqual(errors, []);
  proof.fullscreenRefusal = 'reported and disabled after an intentionally refused request';
});
