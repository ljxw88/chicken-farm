import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { projectCheckpoint } from '../../tools/selfplay/projection.mjs';

const viewport = { width: 1280, height: 720 };
let server, browser, url;
before(async () => {
  server = await createServer({ configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t, search) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__inspectionStep = (time) => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      if (!pending.length) throw new Error('No frame scheduled');
      for (const callback of pending) callback(time);
    };
  });
  await page.goto(`${url}/${search}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__inspectionStep(0));
  return { page, errors };
}

test('inspection is absent by default and for qa=0', { timeout: 90000 }, async (t) => {
  for (const search of ['?phase=daytime&seed=123', '?phase=daytime&seed=123&qa=0']) {
    const { page, errors } = await open(t, search);
    assert.equal(await page.evaluate(() => Object.hasOwn(window, '__game')), false);
    assert.deepEqual(errors, []);
  }
});

test('QA getter returns fresh recursively frozen data and cannot be replaced or used to mutate the game',
  { timeout: 90000 }, async (t) => {
    const { page, errors } = await open(t, '?phase=daytime&weather=clear&seed=123&qa=1');
    const proof = await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(window, '__game');
      const first = window.__game, second = window.__game;
      const allFrozen = (value) => value === null || typeof value !== 'object' ||
        (Object.isFrozen(value) && Object.values(value).every(allFrozen));
      const before = JSON.stringify(first);
      const writes = [Reflect.set(window, '__game', {}), Reflect.deleteProperty(window, '__game'),
        Reflect.set(first.player.position, 0, 999), Reflect.set(first.clock, 'progress', 0.99),
        Reflect.set(first.weather, 'mode', 'snow'), Reflect.set(first.camera.quaternion, 0, 999),
        Reflect.set(first.route.waypoints, 0, [999, 999, 999]), Reflect.set(first.hud.placement, 'active', true)];
      let redefineRejected = false;
      try { Object.defineProperty(window, '__game', { value: {} }); } catch { redefineRejected = true; }
      return { descriptor: { getter: typeof descriptor.get, setter: typeof descriptor.set,
        configurable: descriptor.configurable, enumerable: descriptor.enumerable },
      fresh: first !== second && first.player !== second.player && first.player.position !== second.player.position &&
        first.camera !== second.camera && first.route.waypoints !== second.route.waypoints,
      frozen: allFrozen(first), writes, redefineRejected, before, after: JSON.stringify(window.__game), state: first };
    });
    assert.deepEqual(proof.descriptor, { getter: 'function', setter: 'undefined', configurable: false, enumerable: false });
    assert.equal(proof.fresh, true);
    assert.equal(proof.frozen, true);
    assert.deepEqual(proof.writes, Array(8).fill(false));
    assert.equal(proof.redefineRejected, true);
    assert.equal(proof.before, proof.after);
    assert.equal(proof.state.version, 1);
    assert.deepEqual(proof.state.player, { position: [0, 2.4, 0], yaw: 0 });
    assert.deepEqual(proof.state.clock, { progress: 0.25, cycleSeconds: 1440, held: true });
    assert.equal(proof.state.phase, 'daytime');
    assert.equal(proof.state.nightAmount, 0);
    assert.equal(proof.state.weather.mode, 'clear');
    assert.equal(proof.state.hud.phaseLabel, 'Daytime');
    assert.equal(proof.state.hud.skyEnabled, true);
    assert.equal(proof.state.hud.skyPanelOpen, false);
    assert.equal(proof.state.hud.placement.active, false);
    assert.equal(proof.state.route.status, 'idle');
    assert.deepEqual(errors, []);
  });

test('snapshots track real input, camera, route, weather and HUD without changing older snapshots',
  { timeout: 90000 }, async (t) => {
    const { page, errors } = await open(t, '?phase=daytime&weather=clear&seed=123&qa=1');
    const before = await page.evaluateHandle(() => window.__game);
    await page.keyboard.down('w');
    assert.equal(await page.evaluate(() => window.__game.route.status), 'manual');
    await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__inspectionStep(i * 100); });
    await page.keyboard.up('w');
    const walked = await page.evaluate(() => window.__game);
    const original = await before.jsonValue();
    await before.dispose();
    assert.deepEqual(original.player.position, [0, 2.4, 0]);
    assert.ok(Math.hypot(walked.player.position[0], walked.player.position[2]) > 0.5);
    assert.notDeepEqual(walked.camera.position, original.camera.position);
    assert.equal(walked.route.status, 'idle');

    const goal = [2.5, 2.4, -1.7];
    const screen = projectCheckpoint(walked.camera, goal, viewport);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, screen), 'scene');
    await page.mouse.click(screen.x, screen.y);
    const route = await page.evaluate(() => {
      const game = window.__game;
      return { route: game.route, targetFrozen: Object.isFrozen(game.route.target),
        waypointsFrozen: Object.isFrozen(game.route.waypoints) && game.route.waypoints.every(Object.isFrozen),
        targetWrite: Reflect.set(game.route.target, 0, 999) };
    });
    assert.equal(route.route.status, 'following');
    assert.equal(route.targetFrozen, true);
    assert.equal(route.waypointsFrozen, true);
    assert.equal(route.targetWrite, false);
    await page.evaluate(() => {
      window.setWeather('rain');
      window.__inspectionStep(1675);
    });
    const changed = await page.evaluate(() => window.__game);
    assert.equal(changed.weather.mode, 'rain');
    assert.equal(changed.weather.rainProgress, 0.5);
    assert.equal(changed.weather.rainAmount, 0.5);
    assert.equal(changed.clock.progress, 0.25);
    assert.notDeepEqual(changed.player.position, walked.player.position);
    assert.notEqual(changed.route.target?.[0], 999);
    await page.evaluate(() => { window.setWeather('snow'); window.__inspectionStep(2550); });
    const snow = await page.evaluate(() => window.__game.weather);
    assert.equal(snow.mode, 'snow');
    assert.equal(snow.rainProgress, 0);
    assert.equal(snow.snowProgress, 0.5);
    assert.equal(snow.snowAmount, 0.5);
    await page.keyboard.press('f');
    assert.equal(await page.evaluate(() => window.__game.hud.placement.active), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__game.hud.placement.active), false);
    await page.locator('[data-action="sky"]').click();
    assert.equal(await page.evaluate(() => window.__game.hud.skyPanelOpen), true);
    await page.locator('[aria-labelledby="change-weather-label"]').click();
    assert.equal(await page.evaluate(() => window.__game.hud.weatherAutomatic), true);
    assert.deepEqual(errors, []);
  });

test('the inspection follows the normal unpinned game clock', { timeout: 90000 }, async (t) => {
  const { page, errors } = await open(t, '?qa=1&seed=123');
  const initial = await page.evaluate(() => window.__game.clock);
  assert.equal(initial.held, false);
  await page.evaluate(() => window.__inspectionStep(1000));
  const later = await page.evaluate(() => window.__game.clock);
  assert.ok(Math.abs(later.progress - initial.progress - 1 / 1440) < 1e-12);
  assert.deepEqual(errors, []);
});

test('the inspection reports a disabled sky HUD without exposing a DOM object', { timeout: 90000 }, async (t) => {
  const { page, errors } = await open(t, '?qa=1&skyhud=0&phase=night&seed=123');
  const game = await page.evaluate(() => window.__game);
  assert.equal(game.hud.skyEnabled, false);
  assert.equal(game.hud.skyPanelOpen, false);
  assert.equal(game.hud.weatherAutomatic, null);
  assert.equal(game.hud.phaseLabel, 'Night');
  assert.equal(game.phase, 'night');
  assert.equal(game.nightAmount, 1);
  assert.deepEqual(errors, []);
});
