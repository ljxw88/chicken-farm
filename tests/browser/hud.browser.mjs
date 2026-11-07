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
let evidenceReady = false;

function serverUrl(server) {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

before(async () => {
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    evidenceReady = true;
  }
  devServer = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await devServer.listen();
  devUrl = serverUrl(devServer.httpServer);
  previewServer = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  previewUrl = serverUrl(previewServer.httpServer);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});

after(async () => {
  if (evidenceReady) await writeFile(join(evidenceDir, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await devServer?.close();
  if (previewServer) await new Promise((resolve) => previewServer.httpServer.close(resolve));
});

async function openPage(context, url, instrument = false) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  if (instrument) {
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr36Test = typeof context !== 'undefined' ? context : { scene, camera, character, placement, skyState, skyHud, farmHud, dayNight, weather, follow, composer, engine };\n` });
    });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.getDayNightState && window.getWeather));
  if (instrument) await page.waitForFunction(() => Boolean(window.__ebr36Test));
  return { page, errors };
}

async function capture(page, name) {
  if (evidenceDir) await page.screenshot({ path: join(evidenceDir, name) });
}

async function position(page) {
  return page.evaluate(() => window.__ebr36Test.character.position.toArray());
}

async function placed(page) {
  return page.evaluate(() => window.__ebr36Test.scene.getObjectByName('placement-layer').children
    .filter((child) => child.name === 'placed-fence' || child.name === 'placed-plot').length);
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

async function findUncoveredPlacement(page) {
  // Search real pointer positions; the current scene, not a fake placement API,
  // decides whether a free tile is valid and outside all HTML controls.
  for (let y = 110; y < 500; y += 30) {
    for (let x = 100; x < 1180; x += 40) {
      const hitsCanvas = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id === 'scene', { x, y });
      if (!hitsCanvas) continue;
      await page.mouse.move(x, y);
      if (/Ready to place/.test(await page.locator('.placement-status').textContent())) return { x, y };
    }
  }
  throw new Error('No uncovered, valid placement tile found');
}

async function walkToUncoveredGround(page, touch = false) {
  const targets = await page.evaluate(() => {
    const { camera, character } = window.__ebr36Test;
    camera.updateMatrixWorld();
    const offsets = [[0, -1.5], [-1.5, 0], [1.5, 0], [0, 1.5], [-2, -1], [2, -1]];
    // The desktop panel deliberately covers the lower island, so search the
    // remaining visible grass as well as points near the player.
    for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
      offsets.push([x - character.position.x, z - character.position.z]);
    }
    offsets.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    return offsets.flatMap(([dx, dz]) => {
      const x = character.position.x + dx;
      const z = character.position.z + dz;
      if (Math.abs(x) > 7 || Math.abs(z) > 7 || Math.hypot(dx, dz) < 1) return [];
      const projected = character.position.clone().set(x, 2.4, z).project(camera);
      const px = (projected.x + 1) * innerWidth / 2;
      const py = (1 - projected.y) * innerHeight / 2;
      return document.elementFromPoint(px, py)?.id === 'scene' ? [{ x: px, y: py }] : [];
    }).slice(0, 25);
  });
  for (const target of targets) {
    const before = await position(page);
    if (touch) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
    try {
      await page.waitForFunction((start) => {
        const p = window.__ebr36Test.character.position;
        return Math.hypot(p.x - start[0], p.z - start[2]) > 0.15;
      }, before, { timeout: 2500 });
      return target;
    } catch {
      // A visible point can still be behind an actual obstacle; try another.
    }
  }
  throw new Error('No uncovered ground click moved the chicken');
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function assertNoHorizontalOverflow(page) {
  const widths = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    panel: document.querySelector('#sky-panel')?.scrollWidth,
    panelClient: document.querySelector('#sky-panel')?.clientWidth,
    placement: document.querySelector('.placement-controls').scrollWidth,
    placementClient: document.querySelector('.placement-controls').clientWidth,
  }));
  assert.ok(widths.document <= widths.viewport && widths.panel <= widths.panelClient &&
    widths.placement <= widths.placementClient, `horizontal overflow: ${JSON.stringify(widths)}`);
}

async function assertSeparated(page, viewport, active = false) {
  const panel = await page.locator('#sky-panel').boundingBox();
  const toolbar = await page.locator('.hud-toolbar').boundingBox();
  const placement = await page.locator('.placement-controls').boundingBox();
  const biome = await page.locator('.farm-biome').boundingBox();
  for (const [name, box] of Object.entries({ panel, toolbar, placement, biome })) {
    assert.ok(box, `${name} missing at ${viewport.width}x${viewport.height}`);
    assert.ok(box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= viewport.width + 0.5 && box.y + box.height <= viewport.height + 0.5,
      `${name} outside viewport: ${JSON.stringify(box)}`);
  }
  const pairs = [[panel, toolbar], [panel, placement], [panel, biome],
    [toolbar, placement], [toolbar, biome], [biome, placement]];
  for (const [a, b] of pairs) {
    assert.equal(overlaps(a, b), false, `overlap ${viewport.width}x${viewport.height} active=${active}: ${JSON.stringify({ a, b })}`);
  }
  await assertNoHorizontalOverflow(page);
  return { panel, toolbar, placement, biome };
}

async function assertClosedSeparated(page, viewport) {
  const toolbar = await page.locator('.hud-toolbar').boundingBox();
  const placement = await page.locator('.placement-controls').boundingBox();
  const biome = await page.locator('.farm-biome').boundingBox();
  for (const [name, box] of Object.entries({ toolbar, placement, biome })) {
    assert.ok(box, `${name} missing at ${viewport.width}x${viewport.height}`);
    assert.ok(box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= viewport.width + 0.5 && box.y + box.height <= viewport.height + 0.5,
      `${name} outside viewport: ${JSON.stringify(box)}`);
  }
  const pairs = [[toolbar, placement], [toolbar, biome], [biome, placement]];
  for (const [a, b] of pairs) {
    assert.equal(overlaps(a, b), false, `closed layout overlap ${viewport.width}x${viewport.height}: ${JSON.stringify({ a, b })}`);
  }
  await assertNoHorizontalOverflow(page);
  return { toolbar, placement, biome };
}

test('desktop panel controls real phases, weather, automation and close/reopen', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=morning&weather=clear`, true);
  const panel = page.locator('#sky-panel');
  const sky = page.locator('[data-action="sky"]');
  const follow = page.getByRole('switch', { name: 'Follow the day' });
  const automatic = page.getByRole('switch', { name: 'Let it change' });
  const nextTime = page.getByRole('button', { name: 'Next time of day' });
  const nextWeather = page.getByRole('button', { name: 'Next weather' });
  assert.equal(await panel.isHidden(), true);
  assert.equal(await sky.getAttribute('aria-expanded'), 'false');
  await capture(page, 'toolbar-only-default.png');
  await sky.click();
  assert.equal(await panel.isVisible(), true);
  assert.equal(await page.locator('.hud-panel__footer').textContent(), 'One farm day lasts 24 minutes.');
  assert.deepEqual(await page.evaluate(() => window.getDayNightState()), { phase: 'morning', following: false, cycleSeconds: 1440 });
  assert.equal(await page.getByRole('button', { name: 'Sound unavailable' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'More options unavailable' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Sound unavailable' }).getAttribute('aria-disabled'), 'true');
  assert.equal(await page.getByRole('button', { name: 'Sound unavailable' }).getAttribute('title'), 'Not available yet');
  assert.equal(await page.getByRole('button', { name: 'More options unavailable' }).getAttribute('title'), 'Not available yet');
  assert.equal(await automatic.isEnabled(), true);
  assert.equal(await page.locator('#hud').evaluate((root) => Boolean(root.closest('canvas'))), false);
  const surface = await panel.evaluate((element) => ({
    backdrop: getComputedStyle(element).backdropFilter,
    glass: getComputedStyle(element).getPropertyValue('--hud-glass').trim(),
    rendering: getComputedStyle(element).imageRendering,
    border: getComputedStyle(element).borderTopColor,
    radius: getComputedStyle(element).borderRadius,
    titleSize: getComputedStyle(element.querySelector('h1')).fontSize,
    valueSize: getComputedStyle(element.querySelector('.hud-selector__value')).fontSize,
    toggleSize: getComputedStyle(element.querySelector('.hud-toggle__label')).fontSize,
    footerSize: getComputedStyle(element.querySelector('.hud-panel__footer')).fontSize,
    artwork: element.querySelector('.hud-column__artwork svg').getBoundingClientRect().width,
  }));
  assert.equal(surface.backdrop, 'blur(16px) saturate(1.08)');
  assert.equal(surface.glass, 'rgba(40, 55, 36, 0.68)');
  assert.equal(surface.rendering, 'auto');
  assert.equal(surface.border, 'rgba(255, 253, 238, 0.24)');
  assert.equal(surface.radius, '22px');
  assert.deepEqual([surface.titleSize, surface.valueSize, surface.toggleSize, surface.footerSize, surface.artwork],
    ['20px', '22px', '14px', '13px', 120]);
  assert.equal(await page.getByRole('button', { name: 'Sound unavailable' }).evaluate((node) => getComputedStyle(node).opacity), '0.45');
  const alignment = await panel.evaluate((element) => {
    const measure = (node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = node.getBoundingClientRect();
      const textBox = range.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { text: node.textContent, align: style.textAlign, textLeft: textBox.left,
        textBox: { x: textBox.x, y: textBox.y, width: textBox.width, height: textBox.height },
        contentLeft: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) };
    };
    return [...element.querySelectorAll('.hud-column__heading, .hud-panel__footer')].map(measure);
  });
  assert.deepEqual(alignment.map((item) => item.text), ['Time of day', 'Weather', 'One farm day lasts 24 minutes.']);
  for (const item of alignment) {
    assert.equal(item.align, 'left');
    assert.ok(Math.abs(item.textLeft - item.contentLeft) < 1, `not left-aligned: ${JSON.stringify(item)}`);
  }
  const layout = await assertSeparated(page, { width: 1280, height: 720 });
  assert.ok(Math.abs(layout.panel.width - 536) < 1 && Math.abs(layout.panel.height - 365) < 8, JSON.stringify(layout.panel));
  assert.ok(Math.abs(layout.panel.y + layout.panel.height - 626) < 1, JSON.stringify(layout.panel));
  await capture(page, 'desktop-1280-open.png');

  for (const [phase, label, color] of [
    ['daytime', 'Daytime', 0xa8d4f0], ['sunset', 'Sunset', 0xe8dec6],
    ['night', 'Night', 0x2a2848], ['morning', 'Morning', 0xe8d4c8],
  ]) {
    await nextTime.click();
    assert.equal(await page.evaluate(() => window.getDayNightState().phase), phase);
    assert.equal(await follow.getAttribute('aria-checked'), 'false');
    assert.equal(await page.evaluate(() => window.__ebr36Test.scene.getObjectByName('day-night-hemisphere').color.getHex()), color);
    await page.waitForFunction((expected) => document.querySelector('.farm-biome [data-phase]').textContent === expected, label);
    assert.equal(await sky.getAttribute('data-sky-phase'), phase);
  }
  await page.getByRole('button', { name: 'Previous time of day' }).click();
  assert.equal(await page.evaluate(() => window.getDayNightState().phase), 'night');
  await nextTime.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => window.getDayNightState().phase), 'morning');

  for (const [mode, label] of [['cloudy', 'Cloudy'], ['rain', 'Gentle rain'], ['clear', 'Clear skies']]) {
    await nextWeather.click();
    assert.equal(await page.evaluate(() => window.getWeather().mode), mode);
    assert.equal(await page.locator('.hud-column').nth(1).locator('.hud-selector__value').textContent(), label);
  }
  await page.getByRole('button', { name: 'Previous weather' }).click();
  await page.waitForFunction(() => window.getWeather().rainAmount > 0.2, null, { timeout: 10000 });
  await page.evaluate(() => { window.setWeather('cloudy'); window.setDayNightPhase('sunset'); });
  await page.waitForFunction(() => window.getWeather().cloudyAmount > 0.2, null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.hud-selector__value')[1].textContent === 'Cloudy');
  await page.waitForFunction(() => document.querySelector('[data-action="sky"]').dataset.skyPhase === 'sunset');
  await page.waitForFunction(() => document.querySelector('[aria-labelledby="follow-day-label"]').getAttribute('aria-checked') === 'true');
  await follow.click();
  assert.equal(await page.evaluate(() => window.getDayNightState().following), false);
  await page.evaluate(() => { window.setDayNightCycleSeconds(8); window.setDayNightFollowing(false); window.setWeather('clear'); });
  await page.waitForFunction(() => document.querySelector('.hud-panel__footer').textContent === 'One farm day lasts 8 seconds.');
  await page.waitForFunction(() => window.getWeather().rainAmount < 0.01 && window.getWeather().cloudyAmount < 0.01, null, { timeout: 10000 });
  await automatic.click();
  // Advance the real adapter's clock without waiting 90 wall-clock seconds.
  await page.evaluate(() => { window.__ebr36Test.skyState.update(0); window.__ebr36Test.skyState.update(80); });
  assert.equal(await page.evaluate(() => window.getWeather().mode), 'clear');
  await page.evaluate(() => window.__ebr36Test.skyState.update(10.5));
  await page.waitForFunction(() => window.getWeather().mode === 'cloudy' && window.getWeather().cloudyAmount > 0.2, null, { timeout: 15000 });
  assert.equal(await automatic.getAttribute('aria-checked'), 'true');
  await nextWeather.click();
  assert.equal(await automatic.getAttribute('aria-checked'), 'false');
  await page.evaluate(() => { window.setDayNightCycleSeconds(1440); window.setDayNightPhase('night'); window.setDayNightFollowing(false); });
  await page.waitForFunction(() => window.getWeather().mode === 'rain' && window.getWeather().rainAmount > 0.99, null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.hud-panel__footer').textContent === 'One farm day lasts 24 minutes.');
  await capture(page, 'desktop-1280-night-rain-open.png');
  await page.evaluate(() => { window.setDayNightCycleSeconds(8); window.setDayNightFollowing(false); });
  await page.waitForFunction(() => document.querySelector('.hud-panel__footer').textContent === 'One farm day lasts 8 seconds.');
  await follow.click();
  assert.equal(await page.evaluate(() => window.getDayNightState().following), true);
  const initialPhase = await page.evaluate(() => window.getDayNightState().phase);
  await page.waitForFunction((phase) => window.getDayNightState().phase !== phase, initialPhase, { timeout: 12000 });

  const fullscreen = page.locator('[data-action="fullscreen"]');
  let fullscreenResult = 'unsupported and disabled';
  if (await fullscreen.isEnabled()) {
    await fullscreen.click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement) || document.querySelector('[data-action="fullscreen"]').disabled);
    if (await page.evaluate(() => Boolean(document.fullscreenElement))) {
      await fullscreen.click();
      await page.waitForFunction(() => !document.fullscreenElement);
      fullscreenResult = 'entered and exited';
    } else {
      fullscreenResult = 'denied and disabled';
    }
  }

  await page.getByRole('button', { name: 'Close sky settings', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await panel.isHidden(), true);
  assert.equal(await sky.getAttribute('aria-expanded'), 'false');
  assert.equal(await sky.evaluate((element) => element === document.activeElement), true);
  await capture(page, 'desktop-1280-closed.png');
  await page.keyboard.press('Enter');
  assert.equal(await panel.isVisible(), true);
  await nextTime.focus();
  await page.keyboard.press('Escape');
  assert.equal(await panel.isHidden(), true);
  assert.deepEqual(errors, []);
  proof.desktop = { surface, alignment, cycling: 'four phases, three real weather states, both automations', fullscreen: fullscreenResult, errors };
});

test('desktop Woodland and placement bars stay unchanged unless placement state changes', { timeout: 60000 }, async (t) => {
  const contexts = [];
  const pages = [];
  const errors = [];
  for (const hideSky of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    contexts.push(context);
    t.after(() => context.close());
    await context.addInitScript(() => {
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__desktopBarStep = (time) => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        if (!pending.length) throw new Error('No animation frame scheduled');
        for (const callback of pending) callback(time);
      };
    });
    const opened = await openPage(context, `${devUrl}/?phase=morning&weather=clear&seed=0xeb730001${hideSky ? '&skyhud=0' : ''}`);
    pages.push(opened.page);
    errors.push(opened.errors);
    await opened.page.evaluate(() => document.fonts.ready);
    await opened.page.evaluate(() => { for (let i = 0; i <= 25; i++) window.__desktopBarStep(i * 100); });
  }
  const [hidden, visible] = pages;
  const inspect = (page) => page.evaluate(() => {
    const rect = (node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const bar = document.querySelector('.placement-controls');
    const biome = document.querySelector('.farm-biome');
    return { placement: { box: rect(bar), active: bar.classList.contains('is-active'),
      top: getComputedStyle(bar).top, left: getComputedStyle(bar).left, transform: getComputedStyle(bar).transform,
      buttons: [...bar.querySelectorAll('button')].filter((button) => !button.closest('[hidden]')).map((button) => ({
        text: button.textContent.trim(), disabled: button.disabled, pressed: button.getAttribute('aria-pressed'),
        hovered: button.matches(':hover'), focused: button === document.activeElement,
      })) }, biome: { box: rect(biome), text: biome.textContent.trim() } };
  });
  const screenshot = async (context, page, name) => {
    const cdp = await context.newCDPSession(page);
    try {
      const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
      if (evidenceDir) await writeFile(join(evidenceDir, name), bytes);
      return bytes;
    } finally { await cdp.detach(); }
  };
  const compare = (first, second, regions) => visible.evaluate(async ({ a, b, regions }) => {
    const decode = async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    };
    const [before, after] = await Promise.all([decode(a), decode(b)]);
    const canvas = document.createElement('canvas');
    canvas.width = before.width; canvas.height = before.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(before, 0, 0);
    const original = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(after, 0, 0);
    const current = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return Object.fromEntries(Object.entries(regions).map(([name, [left, top, right, bottom]]) => {
      let pixels = 0, minX = right, minY = bottom, maxX = -1, maxY = -1;
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
        const i = (y * canvas.width + x) * 4;
        if ([0, 1, 2, 3].every((channel) => original[i + channel] === current[i + channel])) continue;
        pixels++;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return [name, { pixels, bounds: pixels ? { minX, minY, maxX, maxY } : null }];
    }));
  }, { a: first.toString('base64'), b: second.toString('base64'), regions });

  const baselineState = await inspect(hidden);
  const baselineImage = await screenshot(contexts[0], hidden, 'desktop-bars-hidden.png');
  const closedState = await inspect(visible);
  const closedImage = await screenshot(contexts[1], visible, 'desktop-bars-closed.png');
  await visible.evaluate(() => document.querySelector('[data-action="sky"]').click());
  const openState = await inspect(visible);
  const openImage = await screenshot(contexts[1], visible, 'desktop-bars-open.png');
  assert.deepEqual(closedState, baselineState);
  assert.deepEqual(openState, baselineState);
  const idleRegions = { woodland: [0, 0, 260, 150], placement: [450, 0, 830, 150] };
  const closedDiff = await compare(baselineImage, closedImage, idleRegions);
  const openDiff = await compare(baselineImage, openImage, idleRegions);
  for (const region of ['woodland', 'placement']) {
    assert.equal(closedDiff[region].pixels, 0, `closed ${region}: ${JSON.stringify(closedDiff[region])}`);
    assert.equal(openDiff[region].pixels, 0, `open ${region}: ${JSON.stringify(openDiff[region])}`);
  }

  // Demonstrate real bar-state changes without changing its desktop CSS.
  await visible.evaluate(() => document.querySelector('[data-action="sky"]').click());
  const fence = await visible.locator('[data-fence]').boundingBox();
  await visible.mouse.move(fence.x + fence.width / 2, fence.y + fence.height / 2);
  const hoverState = await inspect(visible);
  const hoverImage = await screenshot(contexts[1], visible, 'desktop-bars-hover.png');
  const stateRegions = { woodland: [0, 0, 260, 150], placement: [450, 0, 830, 220], frame: [0, 0, 1280, 720] };
  const hoverDiff = await compare(closedImage, hoverImage, stateRegions);
  assert.deepEqual(hoverState.placement.box, baselineState.placement.box);
  assert.equal(hoverState.placement.buttons.find((button) => button.text.startsWith('Fence')).hovered, true);
  assert.ok(hoverDiff.placement.pixels > 0, 'hover must visibly differ from idle');
  assert.equal(hoverDiff.frame.pixels, hoverDiff.placement.pixels, 'idle-to-hover changes must stay at the placement bar');

  // Selecting Fence expands the detail and highlights the button.
  await visible.mouse.move(0, 0);
  await visible.evaluate(() => document.querySelector('[data-fence]').click());
  const activeState = await inspect(visible);
  const activeImage = await screenshot(contexts[1], visible, 'desktop-bars-active.png');
  const activeDiff = await compare(closedImage, activeImage, stateRegions);
  assert.equal(activeState.placement.active, true);
  assert.equal(activeState.placement.buttons.find((button) => button.text.startsWith('Fence')).pressed, 'true');
  assert.ok(activeDiff.placement.pixels > 0, 'active placement must visibly differ from idle');
  assert.equal(activeDiff.woodland.pixels, 0);
  assert.equal(activeDiff.frame.pixels, activeDiff.placement.pixels, 'idle-to-active changes must stay at the placement bar');
  for (const list of errors) assert.deepEqual(list, []);
  proof.desktopBarAudit = { baselineState, closedState, openState, hoverState, activeState, closedDiff, openDiff, hoverDiff, activeDiff, errors };
});

test('panel input does not walk or place; walking and placement work with it open and closed', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  const sky = page.locator('[data-action="sky"]');
  const next = page.getByRole('button', { name: 'Next time of day' });
  const start = await position(page);
  await sky.focus();
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  await page.keyboard.press('f');
  assert.ok(distance(start, await position(page)) < 0.001, 'a focused toolbar moved the chicken');
  assert.equal(await page.locator('.placement-detail').isHidden(), true);
  await sky.click();
  await next.click();
  await page.waitForTimeout(300);
  assert.ok(distance(start, await position(page)) < 0.001, 'a panel click moved the chicken');
  await next.focus();
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  for (const key of ['f', 'p', 'r', 'z']) await page.keyboard.press(key);
  assert.ok(distance(start, await position(page)) < 0.001, 'a focused panel moved the chicken');
  assert.equal(await page.locator('.placement-detail').isHidden(), true, 'a focused panel triggered placement');
  const openWalkPoint = await walkToUncoveredGround(page);

  const beforeWASD = await position(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  const afterWASD = await position(page);
  assert.ok(distance(beforeWASD, afterWASD) > 0.2, 'WASD failed after returning focus to the canvas');
  await page.keyboard.press('f');
  assert.equal(await page.locator('.placement-detail').isVisible(), true);
  const point = await findUncoveredPlacement(page);
  assert.equal(await placed(page), 0);
  await page.mouse.click(point.x, point.y);
  assert.equal(await placed(page), 1, 'placing on uncovered ground failed with panel open');
  const beforePanelClick = await position(page);
  await next.click();
  await page.keyboard.press('z');
  await page.keyboard.press('r');
  await page.waitForTimeout(250);
  assert.equal(await placed(page), 1, 'a panel click placed another object');
  assert.ok(distance(beforePanelClick, await position(page)) < 0.001);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sky-panel').isHidden(), true);
  assert.equal(await page.locator('.placement-detail').isVisible(), true, 'HUD Escape leaked into placement');
  await page.locator('[data-cancel]').click();
  assert.equal(await page.locator('.placement-detail').isHidden(), true);

  const closedWalkPoint = await walkToUncoveredGround(page);
  assert.deepEqual(errors, []);
  proof.input = { start, afterWASD, openWalkPoint, placementPoint: point, closedWalkPoint, errors };
});

test('non-focusable sky surfaces isolate pointer, walking and placement keys', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  const panel = page.locator('#sky-panel');
  const sky = page.locator('[data-action="sky"]');
  const focusBody = async () => {
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
    assert.equal(await page.evaluate(() => document.activeElement === document.body), true);
  };
  const placementState = () => page.evaluate(() => {
    const state = [...window.__ebr36Test.engine.world.with('placement')][0].placement;
    return { kind: state.kind, rotation: state.rotation };
  });
  const assertIsolated = async (name, action) => {
    await focusBody();
    const before = await position(page);
    await action();
    await page.keyboard.down('w');
    await page.waitForTimeout(450);
    await page.keyboard.up('w');
    assert.ok(distance(before, await position(page)) < 0.001, `${name}: W moved the chicken`);
    for (const key of ['f', 'p', 'r', 'z']) await page.keyboard.press(key);
    assert.equal(await page.evaluate(() => window.__ebr36Test.placement.isActive()), false, `${name}: placement shortcut leaked`);
    assert.equal(await placed(page), 0);
  };

  await sky.click();
  await assertIsolated('heading', () => page.getByRole('heading', { name: 'A changing sky' }).click());
  await assertIsolated('panel padding', () => panel.click({ position: { x: 8, y: 80 } }));
  await assertIsolated('illustration', () => page.locator('.hud-column__artwork').first().click());
  await assertIsolated('column divider', async () => {
    const box = await page.locator('.hud-column').nth(1).boundingBox();
    await page.mouse.click(box.x + 0.5, box.y + box.height / 2);
  });
  await assertIsolated('footer divider', async () => {
    const box = await page.locator('.hud-panel__footer').boundingBox();
    await page.mouse.click(box.x + 30, box.y + 0.5);
  });
  await assertIsolated('toolbar gap', async () => {
    const a = await page.locator('.hud-toolbar__button').nth(0).boundingBox();
    const b = await page.locator('.hud-toolbar__button').nth(1).boundingBox();
    await page.mouse.click((a.x + a.width + b.x) / 2, a.y + a.height / 2);
  });
  await assertIsolated('disabled toolbar button', async () => {
    const box = await page.getByRole('button', { name: 'Sound unavailable' }).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  });
  await assertIsolated('pointerdown before click', async () => {
    const box = await panel.boundingBox();
    await page.mouse.move(box.x + 8, box.y + 80);
    await page.mouse.down();
  });
  await page.mouse.up();
  await assertIsolated('enabled button pointerdown', async () => {
    const box = await page.getByRole('button', { name: 'Next time of day' }).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
  });
  await page.mouse.up();

  await page.getByRole('heading', { name: 'A changing sky' }).click();
  await page.keyboard.press('Escape');
  assert.equal(await panel.isHidden(), true, 'Escape in the panel should close it');

  await focusBody();
  await page.keyboard.press('f');
  assert.equal((await placementState()).kind, 'fence');
  await focusBody();
  await page.keyboard.press('r');
  assert.equal((await placementState()).rotation, 1);
  await focusBody();
  await page.keyboard.press('p');
  assert.deepEqual(await placementState(), { kind: 'plot', rotation: 0 });
  const point = await findUncoveredPlacement(page);
  await page.mouse.click(point.x, point.y);
  assert.equal(await placed(page), 1);
  await focusBody();
  await page.keyboard.press('z');
  assert.equal(await placed(page), 0);
  await focusBody();
  await page.keyboard.press('Escape');
  assert.equal((await placementState()).kind, null);
  assert.deepEqual(errors, []);
  proof.surfaceInput = { areas: ['heading', 'padding', 'illustration', 'column divider', 'footer divider',
    'toolbar gap', 'disabled button', 'pointerdown', 'enabled button pointerdown'],
    bodyShortcuts: ['F', 'R', 'P', 'Z', 'Escape'], errors };
});

test('touching non-focusable sky surfaces keeps subsequent walking keys isolated', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  await page.locator('[data-action="sky"]').tap();
  const targets = [
    ['heading', () => page.locator('.hud-panel__header h1').tap()],
    ['illustration', () => page.locator('.hud-column__artwork').first().tap()],
    ['footer', () => page.locator('.hud-panel__footer').tap()],
    ['enabled selector', () => page.getByRole('button', { name: 'Next time of day' }).tap()],
    ['toolbar gap', async () => {
      const a = await page.locator('.hud-toolbar__button').nth(0).boundingBox();
      const b = await page.locator('.hud-toolbar__button').nth(1).boundingBox();
      await page.touchscreen.tap((a.x + a.width + b.x) / 2, a.y + a.height / 2);
    }],
    ['disabled toolbar button', async () => {
      const box = await page.getByRole('button', { name: 'Sound unavailable' }).boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    }],
  ];
  for (const [name, action] of targets) {
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
    const before = await position(page);
    await action();
    await page.keyboard.down('w');
    await page.waitForTimeout(450);
    await page.keyboard.up('w');
    assert.ok(distance(before, await position(page)) < 0.001, `${name}: W moved after touch`);
    await page.keyboard.press('f');
    assert.equal(await page.evaluate(() => window.__ebr36Test.placement.isActive()), false);
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#sky-panel').isHidden(), true);
  assert.deepEqual(errors, []);
  proof.touchSurfaceInput = { targets: targets.map(([name]) => name), errors };
});

test('touch scrolling remains available inside the compact sky panel', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`, true);
  await page.locator('[data-action="sky"]').tap();
  const panel = page.locator('#sky-panel');
  const dimensions = await panel.evaluate((node) => ({ client: node.clientHeight, scroll: node.scrollHeight, top: node.scrollTop }));
  assert.ok(dimensions.scroll > dimensions.client, `panel is not scrollable: ${JSON.stringify(dimensions)}`);
  const box = await panel.boundingBox();
  const cdp = await context.newCDPSession(page);
  const x = box.x + 10, y = box.y + box.height - 35;
  const point = (nextY) => ({ x, y: nextY, radiusX: 1, radiusY: 1, force: 1, id: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(y)] });
  for (let i = 1; i <= 8; i++) {
    await page.waitForTimeout(30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(y - i * 18)] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
  await cdp.detach();
  const after = await panel.evaluate((node) => node.scrollTop);
  assert.ok(after > dimensions.top, `touch gesture did not scroll the panel: ${after}`);
  const beforeWalk = await position(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(450);
  await page.keyboard.up('w');
  assert.ok(distance(beforeWalk, await position(page)) < 0.001, 'W moved after scrolling inside the panel');
  assert.deepEqual(errors, []);
  proof.touchScroll = { before: dimensions.top, after, errors };
});

test('responsive touch layouts keep the phase pill, placement and sky controls separate', { timeout: 120000 }, async (t) => {
  const results = [];
  for (const [width, height] of [[1260, 1080], [680, 844], [681, 844], [700, 844], [700, 390], [720, 844],
    [480, 390], [568, 390], [390, 844], [320, 568], [844, 390]]) {
    const viewport = { width, height };
    const touch = width < 1000;
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
    t.after(() => context.close());
    const { page, errors } = await openPage(context, `${devUrl}/?phase=morning`, true);
    if (touch) await page.locator('[data-action="sky"]').tap(); else await page.locator('[data-action="sky"]').click();
    const inactive = await assertSeparated(page, viewport);
    assert.ok(inactive.panel.height <= height * 0.62 + 1);
    if (width >= 480 && width < 720 && !(width <= 680 && height <= 505)) assert.equal(inactive.panel.width, width - 24);
    if (height <= 520 && width >= 480) {
      assert.ok(inactive.panel.height >= 180, `compact idle panel too short: ${JSON.stringify(inactive.panel)}`);
    }
    if (width === 700) assert.equal(inactive.placement.y, 18);
    const columnLayout = await page.locator('.hud-column').evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width };
    }));
    if (width < 340) assert.ok(columnLayout[1].y > columnLayout[0].y, 'narrow columns must stack');
    else assert.ok(Math.abs(columnLayout[0].width - columnLayout[1].width) < 1 && Math.abs(columnLayout[0].y - columnLayout[1].y) < 1);
    const artwork = await page.locator('.hud-column__artwork').first().evaluate((node) => ({
      display: getComputedStyle(node).display, height: node.getBoundingClientRect().height,
    }));
    if (height <= 520) assert.equal(artwork.display, 'none');
    else assert.equal(artwork.height, width < 480 ? 72 : width < 720 ? 88 : 120);
    if (width === 700 && height === 390) assert.ok(Math.abs(inactive.panel.height - 200) <= 20, JSON.stringify(inactive.panel));
    const next = page.getByRole('button', { name: 'Next time of day' });
    const nextBox = await next.boundingBox();
    assert.ok(nextBox.width >= 44 && nextBox.height >= 44);
    const before = await position(page);
    if (touch) await next.tap(); else await next.click();
    assert.equal(await page.evaluate(() => window.getDayNightState().phase), 'daytime');
    assert.ok(distance(before, await position(page)) < 0.001);
    await page.getByRole('button', { name: 'Next weather' }).click();
    await page.getByRole('button', { name: 'Next weather' }).click();
    const labels = await page.locator('.hud-selector__value').evaluateAll((nodes) => nodes.map((node) => ({ width: node.clientWidth, content: node.scrollWidth })));
    assert.ok(labels.every(({ width: w, content }) => content <= w), `truncated label at ${width}x${height}: ${JSON.stringify(labels)}`);
    await capture(page, `layout-${width}x${height}.png`);
    if (touch) await page.locator('[data-fence]').tap(); else await page.locator('[data-fence]').click();
    const active = await assertSeparated(page, viewport, true);
    if (height <= 520 && width >= 480) {
      assert.ok(active.panel.height >= 180, `compact active panel too short: ${JSON.stringify(active.panel)}`);
    }
    await page.locator('[data-cancel]').click();
    if (touch) await page.getByRole('button', { name: 'Close sky settings', exact: true }).tap();
    else await page.getByRole('button', { name: 'Close sky settings', exact: true }).click();
    assert.equal(await page.locator('#sky-panel').isHidden(), true);
    const closed = await assertClosedSeparated(page, viewport);
    if (width === 700) assert.equal(closed.placement.y, 18);
    const touchWalk = touch ? await walkToUncoveredGround(page, true) : undefined;
    if (touch) await page.locator('[data-action="sky"]').tap(); else await page.locator('[data-action="sky"]').click();
    assert.equal(await page.locator('#sky-panel').isVisible(), true);
    assert.deepEqual(errors, []);
    results.push({ viewport: `${width}x${height}`, inactive, active, closed, columnLayout, artwork, labels, touchWalk, errors });
    await context.close();
  }
  proof.responsive = results;
});

test('short viewports keep a compact panel and placement usable without overlap', { timeout: 180000 }, async (t) => {
  const results = [];
  for (const [width, height] of [[320, 320], [340, 320], [360, 320], [390, 320], [479, 320], [480, 320], [568, 320], [700, 320],
    [320, 390], [340, 390], [390, 390], [479, 390], [390, 500], [480, 461], [568, 500], [700, 460], [844, 390]]) {
    const viewport = { width, height };
    const context = await browser.newContext({ viewport });
    t.after(() => context.close());
    const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime`);
    assert.equal(await page.locator('#sky-panel').isHidden(), true);
    const closed = await assertClosedSeparated(page, viewport);
    await page.locator('[data-action="sky"]').click();
    const idle = await assertSeparated(page, viewport);
    assert.ok(idle.panel.height >= 180 && idle.panel.height <= height * 0.62 + 1,
      `compact idle panel: ${JSON.stringify(idle.panel)}`);
    await page.getByRole('button', { name: 'Next weather' }).click();
    await page.getByRole('button', { name: 'Next weather' }).click();
    const labels = await page.locator('.hud-selector__value').evaluateAll((nodes) => nodes.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return { width: node.clientWidth, content: node.scrollWidth, lines: range.getClientRects().length };
    }));
    assert.ok(labels.every(({ width: w, content }) => content <= w), `truncated label: ${JSON.stringify(labels)}`);
    assert.ok(labels[0].lines === 1 && labels[1].lines <= 2, `fragmented label: ${JSON.stringify(labels)}`);
    for (const name of ['Previous time of day', 'Next time of day', 'Previous weather', 'Next weather']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `small hit target: ${name} ${JSON.stringify(box)}`);
    }
    await page.locator('[data-fence]').click();
    const active = await assertSeparated(page, viewport, true);
    assert.ok(active.panel.height >= 180 && active.panel.height <= height * 0.62 + 1,
      `compact active panel: ${JSON.stringify(active.panel)}`);
    await page.locator('[data-rotate]').click();
    await page.getByRole('switch', { name: 'Let it change' }).click();
    assert.equal(await page.getByRole('switch', { name: 'Let it change' }).getAttribute('aria-checked'), 'true');
    await capture(page, `compact-${width}x${height}-active.png`);
    await page.locator('[data-cancel]').click();
    await page.getByRole('button', { name: 'Close sky settings', exact: true }).click();
    await assertClosedSeparated(page, viewport);
    assert.deepEqual(errors, []);
    results.push({ viewport: `${width}x${height}`, closed, idle, active, labels, errors });
    await context.close();
  }
  proof.shortLandscape = results;
});

test('frosted text remains legible against real cottage and grass in day, sunset and night', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime&weather=clear`, true);
  await page.locator('[data-action="sky"]').click();
  const measurements = [];
  for (const phase of ['daytime', 'sunset', 'night']) {
    for (const [background, x, z] of [['cottage', -5.5, -5.5], ['grass', 0, 3]]) {
      await page.evaluate(({ phase, x, z }) => {
        const test = window.__ebr36Test;
        test.engine.stop();
        window.setWeather('clear');
        test.weather.update(2);
        window.setDayNightPhase(phase);
        window.setDayNightFollowing(false);
        test.skyHud.update();
        test.farmHud.setPhase(test.dayNight.getPhase());
        test.follow(test.character.position.clone().set(x, 2.4, z));
        test.camera.updateMatrixWorld();
        test.composer.render(0);
      }, { phase, x, z });
      assert.equal(await page.locator('.farm-biome [data-phase]').textContent(), phase[0].toUpperCase() + phase.slice(1));
      const text = await page.evaluate(() => {
        const selectors = [
          ['body', '.hud-panel__header h1, .hud-selector__value'],
          ['muted', '.hud-column__heading, .hud-toggle__label, .hud-panel__footer'],
        ];
        return selectors.flatMap(([kind, selector]) => [...document.querySelectorAll(selector)].map((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          const box = range.getBoundingClientRect();
          return { kind, text: node.textContent, color: getComputedStyle(node).color,
            box: { x: box.x, y: box.y, width: box.width, height: box.height } };
        }));
      });
      await capture(page, `contrast-${phase}-${background}.png`);
      const hideText = await page.addStyleTag({ content: '#sky-panel h1, #sky-panel .hud-column__heading, #sky-panel .hud-selector__value, #sky-panel .hud-toggle__label, #sky-panel .hud-panel__footer { color: transparent !important; }' });
      const backgroundFrame = await page.screenshot();
      await hideText.evaluate((node) => node.remove());
      const contrast = await page.evaluate(async ({ png, text }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        const luminance = (rgb) => rgb.map((channel) => {
          const c = channel / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
        return text.map(({ kind, text, color, box }) => {
          const channels = color.match(/[\d.]+/g).map(Number);
          const alpha = channels[3] ?? 1;
          let minimum = Infinity;
          for (let y = Math.max(0, Math.floor(box.y)); y < Math.min(image.height, Math.ceil(box.y + box.height)); y++) {
            for (let x = Math.max(0, Math.floor(box.x)); x < Math.min(image.width, Math.ceil(box.x + box.width)); x++) {
              const i = (y * image.width + x) * 4;
              const behind = [pixels[i], pixels[i + 1], pixels[i + 2]];
              const ink = behind.map((channel, index) => channels[index] * alpha + channel * (1 - alpha));
              const a = luminance(ink), b = luminance(behind);
              minimum = Math.min(minimum, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
            }
          }
          return { kind, text, color, minimum };
        });
      }, { png: backgroundFrame.toString('base64'), text });
      for (const item of contrast) {
        assert.ok(item.minimum >= (item.kind === 'body' ? 4.5 : 3), `${phase}/${background} ${item.text}: ${item.minimum}`);
      }
      measurements.push({ phase, background, contrast });
    }
  }
  assert.deepEqual(errors, []);
  proof.contrast = { method: 'worst WCAG contrast over each text bounding box against the real rendered background; full glyph color', measurements, errors };
});

test('production build renders real controls and handles denied fullscreen honestly', { timeout: 40000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1260, height: 1080 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => true });
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new Error('Fullscreen denied')) });
  });
  await page.goto(`${previewUrl}/?phase=morning`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#scene').evaluate((canvas) => Boolean(canvas.getContext('webgl2'))), true);
  assert.equal(await page.locator('#sky-panel').isHidden(), true);
  await page.locator('[data-action="sky"]').click();
  await page.getByRole('button', { name: 'Next weather' }).click();
  assert.equal(await page.evaluate(() => window.getWeather().mode), 'cloudy');
  await page.locator('[data-action="fullscreen"]').click();
  await page.getByRole('status').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[data-action="fullscreen"]').isDisabled(), true);
  assert.equal(await page.getByRole('status').textContent(), 'Fullscreen is unavailable in this browser.');
  assert.deepEqual(errors, []);
  proof.production = { webgl2: true, realWeather: true, fullscreenRefusal: 'reported and disabled', errors };
});

test('a fullscreen refusal does not push a compact panel into other controls', { timeout: 60000 }, async (t) => {
  const results = [];
  for (const [width, height] of [[700, 390], [700, 320], [320, 320]]) {
    const viewport = { width, height };
    const context = await browser.newContext({ viewport });
    t.after(() => context.close());
    await context.addInitScript(() => {
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get: () => true });
      Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => Promise.reject(new Error('Fullscreen denied')) });
    });
    const { page, errors } = await openPage(context, `${devUrl}/?phase=morning`);
    await page.locator('[data-action="sky"]').click();
    await page.locator('[data-fence]').click();
    await page.locator('[data-action="fullscreen"]').click();
    const status = page.getByRole('status');
    await status.waitFor({ state: 'visible' });
    assert.equal(await status.textContent(), 'Fullscreen is unavailable in this browser.');
    assert.equal(await status.evaluate((node) => Boolean(node.closest('#sky-panel'))), true);
    const active = await assertSeparated(page, viewport, true);
    assert.ok(active.panel.height >= 180, `compact panel after refusal: ${JSON.stringify(active.panel)}`);
    await page.getByRole('button', { name: 'Close sky settings', exact: true }).click();
    assert.equal(await status.isVisible(), true);
    const closed = await assertClosedSeparated(page, viewport);
    const statusBox = await status.boundingBox();
    for (const control of [closed.toolbar, closed.placement, closed.biome]) {
      assert.equal(overlaps(statusBox, control), false, `status overlaps a control: ${JSON.stringify({ statusBox, control })}`);
    }
    assert.deepEqual(errors, []);
    results.push({ viewport: `${width}x${height}`, active, closed, status: statusBox });
    await context.close();
  }
  proof.fullscreenCompact = results;
});

test('skyhud=0 removes the entire sky UI without disabling the scene controls', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, `${devUrl}/?phase=daytime&weather=clear&skyhud=0`, true);
  assert.equal(await page.locator('#hud, #sky-panel, .hud-toolbar').count(), 0);
  assert.equal(await page.locator('.farm-biome').isVisible(), true);
  await page.keyboard.press('f');
  assert.equal(await page.locator('.placement-detail').isVisible(), true);
  assert.deepEqual(errors, []);
  proof.hidden = { skyhud: 0, phasePill: true, placement: true, errors };
});
