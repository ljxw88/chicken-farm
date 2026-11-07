import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { registerEngine } = await vite.ssrLoadModule('/src/app/engine.ts');
const { createDayNightState, createWeatherState } = await vite.ssrLoadModule('/src/environment/index.ts');
after(() => vite.close());

test('registered frame wiring preserves feature order and full environment timing', (t) => {
  const dom = new JSDOM('<canvas id="scene"></canvas>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  const events = [];
  let frame;
  const context = {
    canvas: document.querySelector('#scene'),
    renderer: { setAnimationLoop(callback) { frame = callback; } },
    lastDevicePixelRatio: window.devicePixelRatio,
    handleResize() { events.push('resize'); context.lastDevicePixelRatio = window.devicePixelRatio; },
    character: { position: {} },
    controls: { system(_world, _move, delta) { events.push(`movement:${delta}`); } },
    placement: { isActive: () => false, isRemoving: () => false, update: () => events.push('placement') },
    dayNight: {
      applyState: () => events.push('lighting'), updateCharacterShadow: () => events.push('shadow'),
      getPhase: () => 'morning', getNightAmount: () => { events.push('night'); return 0.25; },
    },
    farmHud: { setPhase: () => events.push('hud') },
    follow: () => events.push('follow'),
    weather: {
      render(delta) { events.push(`weather:${delta}`); },
      getWeather() { events.push('weather-read'); return context.environment.weather; },
    },
    smoke: { update(delta) { events.push(`smoke:${delta}`); } },
    fireflies: { update(delta) { events.push(`fireflies:${delta}`); } },
    updateWaterfall: (delta) => events.push(`waterfall:${delta}`),
    sheepfold: { update: (delta) => events.push(`sheep:${delta}`) },
    composer: { render: (delta) => events.push(`render:${delta}`) },
  };
  registerEngine(context);
  const clock = createDayNightState();
  const weather = createWeatherState();
  weather.mode = 'rain';
  context.environment = context.engine.world.create({ dayNight: clock, weather });
  context.engine.start();
  t.after(() => { context.engine.stop(); dom.window.close(); });
  frame(0);
  events.length = 0;
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  frame(500);
  assert.deepEqual(events, [
    'resize', 'movement:0.1', 'lighting', 'shadow', 'hud', 'follow', 'placement',
    'weather:0.5', 'weather-read', 'night', 'smoke:0.5', 'fireflies:0.5',
    'waterfall:0.5', 'sheep:0.5', 'render:0.5',
  ]);
  assert.equal(clock.progress, 0.5 / 72);
  assert.equal(weather.rainProgress, 0.5 / 1.75);
});
