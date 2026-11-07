import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

test('snapshot describes the live browser world after placement and weather changes', { timeout: 120000 }, async () => {
  const host = process.env.EBR76_DUMP_HOST || '127.0.0.1';
  const port = Number(process.env.EBR76_DUMP_PORT || 0);
  const server = await createServer({ configFile: false, logLevel: 'error',
    server: { host, port, strictPort: Boolean(port), hmr: false } });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
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
      window.__stateStep = (time) => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        if (!pending.length) throw new Error('No animation frame was scheduled');
        for (const callback of pending) callback(time);
      };
    });
    // Test-only access; this does not add a persistence or debug API to the app.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: `${body}
window.__stateTest = { ...context, snapshot: async () => (await import('/src/state/snapshot.ts')).snapshot(context.engine.world) };
` });
    });
    await page.goto(`http://${host}:${address.port}/?phase=daytime&weather=clear&skyhud=0`, { waitUntil: 'networkidle' });
    assert.deepEqual(await page.evaluate(async () => {
      const main = await import('/src/main.ts');
      const setters = ['setDayNightCycleSeconds', 'setDayNightPhase', 'setDayNightFollowing', 'getDayNightState', 'setWeather', 'getWeather']
        .map((name) => main[name] === window[name]);
      const composer = window.__stateTest.composer;
      return [...setters, window.setPixelRendering === composer.setEnabled,
        window.setPixelSize === composer.setPixelSize, window.getPixelRendering === composer.getState];
    }), [true, true, true, true, true, true, true, true, true], 'module exports and console setters keep the same function identities');
    await page.evaluate(() => window.__stateStep(0));
    const initial = await page.evaluate(() => window.__stateTest.snapshot());
    assert.deepEqual(initial.player, { position: [0, 2.4, 0], yaw: 0 });
    assert.deepEqual(initial.clock, { progress: 0.25, cycleSeconds: 1440, held: true });
    assert.deepEqual(initial.placed, []);

    await page.keyboard.press('f');
    const point = await page.evaluate(() => {
      const { camera, character } = window.__stateTest;
      camera.updateMatrixWorld();
      const projected = character.position.clone().set(-0.75, 2.4, 3.75).project(camera);
      const rect = document.querySelector('#scene').getBoundingClientRect();
      return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
    });
    await page.mouse.move(point.x, point.y);
    assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
    await page.keyboard.press('r');
    await page.mouse.click(point.x, point.y);
    await page.evaluate(() => { window.setWeather('rain'); window.__stateStep(875); });
    const result = await page.evaluate(async () => {
      const first = await window.__stateTest.snapshot();
      const roundTrip = JSON.parse(JSON.stringify(first));
      first.player.position[0] = 999;
      first.placed[0].cell[0] = 999;
      return { roundTrip, again: await window.__stateTest.snapshot() };
    });
    assert.equal(result.roundTrip.version, 1);
    assert.equal(result.roundTrip.contentId, 'farm-v1');
    assert.deepEqual(result.roundTrip.weather, { mode: 'rain', rainProgress: 0.5, cloudyProgress: 0, snowProgress: 0 });
    assert.equal(result.roundTrip.placed.length, 1);
    assert.equal(result.roundTrip.placed[0].kind, 'fence');
    assert.equal(result.roundTrip.placed[0].rotation, 1);
    assert.match(result.roundTrip.placed[0].id, /^entity-\d+$/);
    assert.deepEqual(result.roundTrip, result.again, 'snapshot mutations must not affect the live world');
    await page.evaluate(() => { window.setWeather('snow'); window.__stateStep(1750); });
    assert.deepEqual((await page.evaluate(() => window.__stateTest.snapshot())).weather,
      { mode: 'snow', rainProgress: 0, cloudyProgress: 0, snowProgress: 0.5 });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
