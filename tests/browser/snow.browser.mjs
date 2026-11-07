import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

let server;
let browser;
let url;

before(async () => {
  server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
});

after(async () => { await browser?.close(); await server?.close(); });

async function open(phase, weather = 'snow') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(() => {
    let id = 0;
    const frames = new Map();
    window.requestAnimationFrame = (callback) => { frames.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => frames.delete(handle);
    window.__snowStep = (time) => {
      const pending = [...frames.values()];
      frames.clear();
      if (!pending.length) throw new Error('No animation frame was scheduled');
      for (const callback of pending) callback(time);
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__snowTest = typeof context !== 'undefined' ? context : { scene, renderer, composer, character, weather, dayNight };\n` });
  });
  await page.goto(`${url}/?phase=${phase}&weather=${weather}&seed=123`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__snowTest));
  await page.evaluate(() => { for (let i = 0; i <= 30; i++) window.__snowStep(i * 100); });
  return { context, page, errors };
}

async function inspect(page) {
  return page.evaluate(() => {
    const { scene, renderer, composer, character, weather, dayNight } = window.__snowTest;
    const snow = scene.getObjectByName('snow-flakes');
    const flies = scene.getObjectByName('night-fireflies');
    const smoke = scene.getObjectByName('chimney-smoke');
    const visiblePuffs = smoke.children.filter((puff) => puff.visible);
    let pixels;
    if (snow?.visible) {
      const canvas = document.createElement('canvas');
      canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const capture = () => {
        composer.render(0);
        ctx.drawImage(renderer.domElement, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const withSnow = capture();
      snow.visible = false;
      const withoutSnow = capture();
      snow.visible = true;
      composer.render(0);
      const maximum = [0, 0, 0];
      let changed = 0, voidPixels = 0, nonVoidPixels = 0;
      for (let i = 0; i < withSnow.length; i += 4) {
        if ([0, 1, 2].every((channel) => withSnow[i + channel] === withoutSnow[i + channel])) continue;
        changed++;
        if (withoutSnow[i] === 16 && withoutSnow[i + 1] === 20 && withoutSnow[i + 2] === 22) voidPixels++;
        else nonVoidPixels++;
        for (let channel = 0; channel < 3; channel++) maximum[channel] = Math.max(maximum[channel], withSnow[i + channel]);
      }
      pixels = { changed, voidPixels, nonVoidPixels, maximum, width: canvas.width, height: canvas.height };
    }
    return {
      phase: window.getDayNightState().phase,
      weather: weather.getWeather(), snowAmount: weather.getSnowAmount(), nightAmount: dayNight.getNightAmount(),
      snow: snow && { visible: snow.visible, count: snow.count, opacity: snow.material.opacity },
      rainVisible: scene.getObjectByName('rain-streaks').visible,
      splashesVisible: Array.from({ length: 6 }, (_, i) => scene.getObjectByName(`rain-splash-${i + 1}`).visible),
      directional: scene.getObjectByName('day-night-directional').intensity,
      windows: [1, 2].map((i) => scene.getObjectByName(`window-light-${i}`).intensity),
      lantern: character.getObjectByName('lantern-light').intensity,
      fireflies: flies.visible ? Array.from(flies.geometry.getAttribute('instanceOpacity').array).filter((value) => value > 0).length : 0,
      smokeCount: visiblePuffs.length, smokePeakOpacity: Math.max(...visiblePuffs.map((puff) => puff.material.opacity)),
      pixels,
    };
  });
}

test('URL snow renders sparse soft, sub-250 flakes across all phases with unchanged practicals', { timeout: 90000 }, async () => {
  for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
    const { context, page, errors } = await open(phase);
    try {
      const state = await inspect(page);
      assert.equal(state.phase, phase);
      assert.deepEqual(state.weather, { mode: 'snow', rainAmount: 0, cloudyAmount: 0 });
      assert.equal(state.snowAmount, 1);
      assert.deepEqual([state.snow.visible, state.snow.count], [true, 160]);
      assert.ok(Math.abs(state.snow.opacity - (phase === 'night' ? 0.56 : 0.8)) < 1e-9);
      assert.equal(state.rainVisible, false);
      assert.ok(state.splashesVisible.every((visible) => !visible));
      assert.deepEqual(state.windows, phase === 'night' ? [0.85, 0.85] : [0, 0]);
      assert.equal(state.lantern, phase === 'night' ? 0.12 : 0);
      assert.equal(state.fireflies, phase === 'night' ? 14 : 0);
      assert.ok(state.smokeCount >= 4 && state.smokeCount <= 5);
      assert.ok(Math.abs(state.smokePeakOpacity - (phase === 'night' ? 0.45 : 0.75)) < 1e-9);
      assert.deepEqual([state.pixels.width, state.pixels.height], [320, 180]);
      assert.ok(state.pixels.changed > 100 && state.pixels.changed < 1200, JSON.stringify(state.pixels));
      assert.ok(state.pixels.voidPixels > 0 && state.pixels.nonVoidPixels > 0, JSON.stringify(state.pixels));
      assert.ok(state.pixels.maximum.every((channel) => channel < 250), JSON.stringify(state.pixels));
      for (const timestamp of [5000, 8000]) {
        await page.evaluate((time) => window.__snowStep(time), timestamp);
        const later = await inspect(page);
        assert.ok(later.pixels.maximum.every((channel) => channel < 250), `${phase}: ${JSON.stringify(later.pixels)}`);
      }
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('HUD and console toggle all four weather states and snow follows the selected day/night phase', { timeout: 60000 }, async () => {
  const { context, page, errors } = await open('daytime', 'clear');
  let time = 3000;
  const advance = async (delta) => {
    time += delta;
    await page.evaluate((timestamp) => window.__snowStep(timestamp), time);
  };
  try {
    await page.locator('[data-action="sky"]').evaluate((button) => button.click());
    const value = page.locator('.hud-column').nth(1).locator('.hud-selector__value');
    const next = page.getByRole('button', { name: 'Next weather' });
    assert.equal(await value.textContent(), 'Clear skies');
    for (const [mode, label, intensity] of [
      ['cloudy', 'Cloudy', 1.8 * 0.72], ['rain', 'Gentle rain', 1.8 * 0.7],
      ['snow', 'Soft snow', 1.8 * 0.72], ['clear', 'Clear skies', 1.8],
    ]) {
      await next.evaluate((button) => button.click());
      assert.equal(await value.textContent(), label);
      await advance(1750);
      const state = await inspect(page);
      assert.equal(state.weather.mode, mode);
      assert.ok(Math.abs(state.directional - intensity) < 1e-9);
      assert.equal(state.rainVisible, mode === 'rain');
      assert.equal(state.snow?.visible ?? false, mode === 'snow');
      if (mode === 'snow') {
        const illustration = await page.locator('.hud-column').nth(1).locator('.hud-column__artwork').evaluate((node) => ({
          dashes: node.querySelector('g')?.getAttribute('stroke-dasharray'),
          path: node.querySelector('path')?.getAttribute('d'),
        }));
        assert.equal(illustration.dashes, '.1 6');
        assert.match(illustration.path, /M32 75v16.*M57 75v16.*M82 75v16/);
      }
    }
    await page.getByRole('button', { name: 'Previous weather' }).evaluate((button) => button.click());
    assert.equal(await value.textContent(), 'Soft snow');
    await advance(875);
    let state = await inspect(page);
    assert.ok(Math.abs(state.snowAmount - 0.5) < 1e-9);
    assert.ok(Math.abs(state.snow.opacity - 0.4) < 1e-9);
    await advance(875);
    await page.evaluate(() => window.setWeather('rain'));
    await advance(875);
    state = await inspect(page);
    assert.ok(Math.abs(state.snowAmount - 0.5) < 1e-9);
    assert.ok(Math.abs(state.weather.rainAmount - 0.5) < 1e-9);
    assert.equal(state.rainVisible, true);
    assert.equal(state.snow.visible, true);
    await advance(875);
    state = await inspect(page);
    assert.equal(state.snowAmount, 0);
    assert.equal(state.snow.visible, false);
    assert.equal(state.weather.rainAmount, 1);
    await page.evaluate(() => window.setWeather('snow'));
    await advance(1750);
    for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
      await page.evaluate((nextPhase) => { window.setDayNightPhase(nextPhase); window.setDayNightFollowing(false); }, phase);
      await advance(0);
      state = await inspect(page);
      assert.equal(state.phase, phase);
      assert.equal(state.weather.mode, 'snow');
      assert.ok(Math.abs(state.snow.opacity - (phase === 'night' ? 0.56 : 0.8)) < 1e-9);
    }
    await page.evaluate(() => { window.setDayNightPhase('sunset'); window.setDayNightCycleSeconds(72); });
    await advance(9000); // Halfway from sunset to night.
    state = await inspect(page);
    assert.ok(Math.abs(state.nightAmount - 0.5) < 1e-9);
    assert.ok(Math.abs(state.snow.opacity - 0.68) < 1e-9);
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});
