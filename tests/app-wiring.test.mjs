import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { registerEngine } = await vite.ssrLoadModule('/src/app/engine.ts');
const { registerFarm, registerFarmDecorations } = await vite.ssrLoadModule('/src/app/farm.ts');
const { registerGarden } = await vite.ssrLoadModule('/src/app/garden.ts');
const { registerEnvironment } = await vite.ssrLoadModule('/src/app/environment.ts');
const { registerStartup } = await vite.ssrLoadModule('/src/app/startup.ts');
const { registerHud } = await vite.ssrLoadModule('/src/app/hud.ts');
const { createDayNightState, createWeatherState } = await vite.ssrLoadModule('/src/environment/index.ts');
const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
const { createCharacter } = await vite.ssrLoadModule('/src/character/index.ts');
const THREE = await import('three');
after(() => vite.close());

test('registered frame wiring preserves feature order and full environment timing', (t) => {
  const dom = new JSDOM('<canvas id="scene"></canvas>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, Node: globalThis.Node };
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
    phaseController: { frameDelta(delta) { events.push(`clock-delta:${delta}`); return delta / 2; } },
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
    skyState: { update: (delta) => events.push(`sky-state:${delta}`) },
    skyHud: { update: () => events.push('sky-hud') },
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
  t.after(() => { context.engine.stop(); Object.assign(globalThis, previous); dom.window.close(); });
  frame(0);
  events.length = 0;
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  frame(500);
  assert.deepEqual(events, [
    'resize', 'movement:0.1', 'clock-delta:0.5', 'lighting', 'shadow', 'hud', 'follow', 'placement',
    'weather:0.5', 'weather-read', 'night', 'smoke:0.5', 'fireflies:0.5',
    'sky-state:0.5', 'sky-hud', 'waterfall:0.5', 'sheep:0.5', 'render:0.5',
  ]);
  assert.equal(clock.progress, 0.25 / 72);
  assert.equal(weather.rainProgress, 0.5 / 1.75);
});

test('farm and garden registration forwards targets and obstacles in main order', (t) => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/?seed=123' });
  const previous = globalThis.window;
  globalThis.window = dom.window;
  t.after(() => { globalThis.window = previous; dom.window.close(); });
  const context = { scene: new THREE.Scene() };
  registerFarm(context);
  registerGarden(context);
  registerFarmDecorations(context);
  assert.deepEqual(context.clickTargets.map((item) => item.name),
    ['farm-cottage', 'farm-ramp-coop-1', 'farm-ramp-coop-2', 'sheepfold-lean-to', 'sheep-1', 'sheep-2', 'beehive-1', 'beehive-2']);
  assert.deepEqual(context.clickTargets.slice(3, 6), context.sheepfold.clickTargets);
  assert.deepEqual(context.clickTargets.slice(6), context.garden.clickTargets);
  assert.deepEqual(context.obstacles.slice(-2), context.garden.obstacles);
  const children = context.scene.children.map((child) => child.name);
  assert.ok(children.indexOf('farm-sheepfold') < children.indexOf('garden-beehives'));
  assert.ok(children.indexOf('garden-beehives') < children.indexOf('garden-flower-patches'));
  assert.ok(children.indexOf('garden-flower-patches') < children.indexOf('farm-flock-decorations'));
  assert.ok(context.clickTargets.every((target) => context.scene.getObjectById(target.id) === target));
});

test('day/night shadows update farm, sheepfold and garden in main order', (t) => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/?visualSeed=123' });
  const previous = globalThis.window;
  globalThis.window = dom.window;
  t.after(() => { globalThis.window = previous; dom.window.close(); });
  const events = [];
  const track = (name) => (...args) => events.push([name, ...args]);
  const scene = new THREE.Scene();
  const character = createCharacter();
  scene.add(character);
  const context = { scene, character, camera: new THREE.PerspectiveCamera(), windows: [], extraEmissives: [],
    stairs: { supports: () => true }, bridgeHeight: () => undefined, splashExclusions: [],
    farmShadows: { update: track('farm') }, sheepfold: { updateShadows: track('sheepfold') },
    garden: { updateShadows: track('garden') }, engine: { world: createEntityWorld() } };
  registerEnvironment(context);
  events.length = 0;
  context.dayNight.setDayNightPhase('night');
  assert.deepEqual(events.map(([name]) => name), ['farm', 'sheepfold', 'garden']);
  assert.deepEqual(events[0].slice(1), events[1].slice(1));
  assert.deepEqual(events[1].slice(1), events[2].slice(1));
  events.length = 0;
  context.dayNight.setShadowWeather(1, 0);
  assert.deepEqual(events.map(([name]) => name), ['farm', 'sheepfold', 'garden']);
  assert.deepEqual(events[0].slice(1), events[2].slice(1));
  context.weather.dispose();
});

test('startup publishes the main clock controls and 24-minute cycle before weather', (t) => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/?phase=sunset&weather=rain' });
  const previous = globalThis.window;
  globalThis.window = dom.window;
  t.after(() => { globalThis.window = previous; dom.window.close(); });
  const calls = [];
  const state = { phase: 'morning', held: false, cycleSeconds: 72 };
  const dayNight = {
    setHeld(held) { calls.push(['held', held]); state.held = held; },
    isHeld: () => state.held,
    setDayNightCycleSeconds(seconds) { calls.push(['cycle', seconds]); state.cycleSeconds = seconds; },
    setDayNightPhase(phase) { calls.push(['phase', phase]); state.phase = phase; },
    getPhase: () => state.phase,
    update() {},
  };
  const weather = { setWeather(mode) { calls.push(['weather', mode]); }, getWeather: () => ({ mode: 'rain', rainAmount: 0, cloudyAmount: 0 }) };
  const context = { dayNight, weather, environment: { dayNight: state } };
  registerStartup(context);
  assert.deepEqual(calls, [['held', true], ['cycle', 1440], ['phase', 'sunset'], ['weather', 'rain']]);
  assert.deepEqual(window.getDayNightState(), { phase: 'sunset', following: false, cycleSeconds: 1440 });
  assert.equal(window.setDayNightFollowing, context.setDayNightFollowing);
  assert.equal(window.getDayNightState, context.getDayNightState);
  window.setDayNightFollowing(true);
  assert.deepEqual(window.getDayNightState(), { phase: 'sunset', following: true, cycleSeconds: 1440 });
});

test('skyhud=0 removes only the sky root while retaining the farm HUD', (t) => {
  const dom = new JSDOM('<!doctype html><body><div id="farm-hud"></div><div id="hud"></div></body>',
    { url: 'http://localhost/?skyhud=0' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  t.after(() => { globalThis.window = previous.window; globalThis.document = previous.document; dom.window.close(); });
  const context = { hudRoot: document.querySelector('#farm-hud'), skyRoot: document.querySelector('#hud'),
    dayNight: { getPhase: () => 'daytime' } };
  registerHud(context);
  assert.equal(document.querySelector('#hud'), null);
  assert.equal(document.querySelector('[data-phase]').textContent, 'Daytime');
  assert.equal(context.skyState, undefined);
  assert.equal(context.skyHud, undefined);
});

test('normal startup mounts the sky HUD through the public scene adapter', (t) => {
  const dom = new JSDOM('<!doctype html><body><div id="farm-hud"></div><div id="hud"></div></body>',
    { url: 'http://localhost/?phase=night' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  t.after(() => { globalThis.window = previous.window; globalThis.document = previous.document; dom.window.close(); });
  window.getDayNightState = () => ({ phase: 'night', following: false, cycleSeconds: 1440 });
  window.setDayNightPhase = () => {};
  window.setDayNightFollowing = () => {};
  window.getWeather = () => ({ mode: 'clear', rainAmount: 0, cloudyAmount: 0 });
  window.setWeather = () => {};
  const context = { hudRoot: document.querySelector('#farm-hud'), skyRoot: document.querySelector('#hud'),
    dayNight: { getPhase: () => 'night' } };
  registerHud(context);
  assert.ok(context.skyState && context.skyHud);
  assert.equal(document.querySelector('[data-phase]').textContent, 'Night');
  assert.equal(document.querySelector('[data-action="sky"]').dataset.skyPhase, 'night');
  assert.equal(context.skyState.dayNight.getState().cycleSeconds, 1440);
  context.skyHud.dispose();
  context.farmHud.dispose();
});
