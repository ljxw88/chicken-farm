import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
const { createDayNightState, updateDayNightSystem } = await vite.ssrLoadModule('/src/environment/dayNightSystem.ts');
const { createWeatherState, updateWeatherSystem } = await vite.ssrLoadModule('/src/environment/weatherSystem.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { createWeatherSystem } = await vite.ssrLoadModule('/src/weather/createWeatherSystem.ts');
const { createStartupPhaseController, parseStartupOptions } = await vite.ssrLoadModule('/src/startupOptions.ts');
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
after(() => vite.close());

function fixture(t, search = '', withCharacter = false) {
  const world = createEntityWorld();
  const environment = world.create({ dayNight: createDayNightState(), weather: createWeatherState() });
  const scene = new THREE.Scene();
  const character = withCharacter ? createCharacter() : new THREE.Group();
  scene.add(character);
  const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 100);
  camera.position.set(12, 15, 12);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const cycle = createDayNightCycle({ scene, character, windows: [], state: environment.dayNight });
  const weather = createWeatherSystem({ scene, camera, anchor: character, groundHeight: 0, groundSize: 16,
    splashExclusions: [], random: () => 0.5, state: environment.weather,
    setDirectionalIntensityMultiplier: cycle.setDirectionalIntensityMultiplier,
    setAmbientHemisphereColorMultiplier: cycle.setAmbientHemisphereColorMultiplier,
    setShadowWeather: cycle.setShadowWeather });
  const startup = parseStartupOptions(search);
  const controller = createStartupPhaseController(cycle, startup.phase);
  if (startup.weather) weather.setWeather(startup.weather);
  t.after(weather.dispose);
  return { world, environment, scene, character, cycle, weather, controller };
}

test('every URL phase and weather pins the engine clock while weather reaches its requested state', (t) => {
  for (const phase of ['morning', 'daytime', 'sunset', 'night']) for (const mode of ['clear', 'cloudy', 'rain', 'snow']) {
    const f = fixture(t, `?phase=${phase}&weather=${mode}`);
    const progress = f.environment.dayNight.progress;
    updateDayNightSystem(f.world, 100);
    updateWeatherSystem(f.world, 1.75);
    f.weather.render(1.75, f.cycle.getNightAmount());
    assert.equal(f.environment.dayNight.held, true, `${phase}/${mode}`);
    assert.equal(f.environment.dayNight.progress, progress);
    assert.equal(f.cycle.getPhase(), phase);
    assert.deepEqual(f.weather.getWeather(), { mode, rainAmount: Number(mode === 'rain'), cloudyAmount: Number(mode === 'cloudy') });
    assert.equal(f.weather.getSnowAmount(), Number(mode === 'snow'));
    assert.deepEqual(JSON.parse(JSON.stringify(f.environment.weather)), f.environment.weather);
  }
});

test('invalid setters keep a URL hold; valid console-style setters release it without resetting progress', (t) => {
  const f = fixture(t, '?phase=night');
  assert.throws(() => f.controller.setDayNightCycleSeconds(0), RangeError);
  assert.throws(() => f.controller.setDayNightPhase('midnight'), RangeError);
  assert.equal(f.environment.dayNight.held, true);
  f.controller.setDayNightCycleSeconds(144);
  assert.equal(f.environment.dayNight.held, false);
  updateDayNightSystem(f.world, 18);
  f.cycle.applyState();
  assert.equal(f.environment.dayNight.progress, 0.875);
  assert.equal(f.cycle.getPhase(), 'night');
  f.controller.setDayNightPhase('daytime');
  assert.equal(f.environment.dayNight.progress, 0.25);
  assert.equal(f.scene.getObjectByName('day-night-directional').intensity, 1.8);
});

test('the engine clock performs a full 64-step cycle without fixed-tick truncation', (t) => {
  const f = fixture(t);
  for (let i = 1; i <= 64; i++) {
    updateDayNightSystem(f.world, 72 / 64);
    f.cycle.applyState();
    assert.equal(f.environment.dayNight.progress, (i % 64) / 64);
    assert.equal(f.cycle.getPhase(), ['morning', 'daytime', 'sunset', 'night'][Math.floor((i % 64) / 16)]);
  }
  updateDayNightSystem(f.world, 72 * 3 + 18);
  assert.equal(f.environment.dayNight.progress, 0.25);
});

test('engine weather reverses and crossfades continuously and drives the existing render adapter', (t) => {
  const f = fixture(t, '?phase=daytime');
  const state = f.environment.weather;
  f.weather.setWeather('rain');
  updateWeatherSystem(f.world, 0.875);
  f.weather.render(0.875);
  assert.deepEqual(f.weather.getWeather(), { mode: 'rain', rainAmount: 0.5, cloudyAmount: 0 });
  assert.equal(state.rainProgress, 0.5);
  assert.equal(f.scene.getObjectByName('rain-streaks').material.opacity, 0.275); // EBR-88: 0.55 at full rain.
  f.weather.setWeather('cloudy');
  updateWeatherSystem(f.world, 0.4375);
  f.weather.render(0.4375);
  assert.deepEqual(f.weather.getWeather(), { mode: 'cloudy', rainAmount: 0.15625, cloudyAmount: 0.15625 });
  f.weather.setWeather('rain');
  updateWeatherSystem(f.world, 0);
  assert.deepEqual(f.weather.getWeather(), { mode: 'rain', rainAmount: 0.15625, cloudyAmount: 0.15625 });
  updateWeatherSystem(f.world, 1.75);
  f.weather.render(1.75);
  assert.deepEqual(f.weather.getWeather(), { mode: 'rain', rainAmount: 1, cloudyAmount: 0 });
  assert.throws(() => f.weather.setWeather('storm'), RangeError);
  assert.throws(() => updateWeatherSystem(f.world, -1), RangeError);
});

test('engine phase and weather systems preserve the signed character crown across transitions', (t) => {
  const f = fixture(t, '?phase=daytime&weather=cloudy', true);
  const body = f.character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
  const colors = body.geometry.getAttribute('color').array;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
  const check = (base, crown) => {
    near(Math.min(...colors), base);
    near(Math.max(...colors), crown);
    assert.equal(body.material.color.getHex(), 0xffd477);
    assert.equal(body.material.emissive.getHex(), 0);
  };

  check(1.08, 1.08 * 1.28);
  updateWeatherSystem(f.world, 1.75);
  f.weather.render(1.75);
  check(1, 1.28); // Cloud retains the crown but not the extra base gain.
  f.weather.setWeather('rain');
  updateWeatherSystem(f.world, 0.875);
  f.weather.render(0.875);
  check(1.04, 1.04 * 1.28);
  updateWeatherSystem(f.world, 0.875);
  f.weather.render(0.875);
  check(1.08, 1.08 * 1.28);

  f.controller.setDayNightPhase('morning');
  check(1, 1.15);
  updateDayNightSystem(f.world, 9);
  f.cycle.applyState();
  check(1.04, 1.04 * 1.215);
  updateDayNightSystem(f.world, 9);
  f.cycle.applyState();
  check(1.08, 1.08 * 1.28);
  for (const phase of ['sunset', 'night', 'morning']) {
    f.controller.setDayNightPhase(phase);
    check(1, 1.15);
  }
});
