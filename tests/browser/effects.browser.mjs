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
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => { await browser?.close(); await server?.close(); });

async function open(phase, weather, seed = 3950182401) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr42Step = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame was scheduled');
      for (const callback of current) callback(time);
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr42 = { scene, camera, renderer, composer };\n` });
  });
  await page.goto(`${url}/?phase=${phase}&weather=${weather}&seed=${seed}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__ebr42));
  await page.evaluate(() => { for (let i = 0; i <= 30; i++) window.__ebr42Step(i * 100); });
  return { context, page, errors };
}

async function inspect(page) {
  return page.evaluate(() => {
    const { scene, renderer, composer } = window.__ebr42;
    const flies = scene.getObjectByName('night-fireflies');
    const smoke = scene.getObjectByName('chimney-smoke');
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width;
    canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = () => {
      composer.render(0);
      ctx.drawImage(renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const withBoth = pixels();
    const difference = (object) => {
      const wasVisible = object.visible;
      object.visible = false;
      const without = pixels();
      object.visible = wasVisible;
      let changed = 0;
      const maximum = [0, 0, 0];
      for (let i = 0; i < withBoth.length; i += 4) {
        if ([0, 1, 2].some((channel) => withBoth[i + channel] !== without[i + channel])) {
          changed++;
          for (let channel = 0; channel < 3; channel++) maximum[channel] = Math.max(maximum[channel], withBoth[i + channel]);
        }
      }
      return { changed, maximum };
    };
    const flyDiff = difference(flies);
    const smokeDiff = difference(smoke);
    const opacity = Array.from(flies.geometry.getAttribute('instanceOpacity').array);
    const rainPositions = Array.from(scene.getObjectByName('rain-streaks').geometry.getAttribute('position').array.slice(0, 30));
    return {
      pixel: window.getPixelRendering(), weather: window.getWeather(),
      active: flies.visible ? opacity.filter((value) => value > 0).length : 0,
      opacity, matrices: Array.from(flies.instanceMatrix.array), rainPositions,
      smokePuffs: smoke.children.filter((puff) => puff.visible).map((puff) => ({
        position: puff.position.toArray(), size: puff.scale.x, opacity: puff.material.opacity, rotation: puff.rotation.y,
      })),
      flyDiff, smokeDiff,
    };
  });
}

test('pixel-pass app renders smoke at every phase and the correct weather-dependent fireflies', { timeout: 90000 }, async () => {
  const cases = [
    ['morning', 'clear', 0], ['daytime', 'clear', 0], ['sunset', 'clear', 0],
    ['night', 'clear', 14], ['night', 'cloudy', 10], ['night', 'rain', 6],
  ];
  for (const [phase, weather, expected] of cases) {
    const { context, page, errors } = await open(phase, weather);
    try {
      const state = await inspect(page);
      assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight], [320, 180]);
      assert.equal(state.pixel.enabled, true);
      assert.equal(state.active, expected, `${phase}/${weather}`);
      assert.ok(state.smokePuffs.length >= 3 && state.smokePuffs.length <= 5);
      assert.ok(state.smokeDiff.changed > 0, `smoke is not visible: ${phase}/${weather}`);
      if (expected) {
        assert.ok(state.flyDiff.changed > 0, `fireflies are not visible: ${phase}/${weather}`);
        assert.ok(state.flyDiff.maximum.every((channel) => channel < 250), `bright mote ${state.flyDiff.maximum}`);
      } else assert.equal(state.flyDiff.changed, 0);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test('seeded rain and both visual effects replay exactly at a controlled frame', { timeout: 60000 }, async () => {
  const samples = [];
  for (const seed of [3950182401, 3950182401, 3950182402]) {
    const { context, page, errors } = await open('night', 'rain', seed);
    try {
      samples.push(await inspect(page));
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  for (const field of ['opacity', 'matrices', 'rainPositions', 'smokePuffs']) {
    assert.deepEqual(samples[0][field], samples[1][field], field);
    assert.notDeepEqual(samples[0][field], samples[2][field], field);
  }
});
