import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createCharacterController } = await vite.ssrLoadModule('/src/character/createCharacterController.ts');
const { createEngine } = await vite.ssrLoadModule('/src/core/loop/createEngine.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { createRainEffect } = await vite.ssrLoadModule('/src/weather/createRainEffect.ts');
const { createWeatherSystem } = await vite.ssrLoadModule('/src/weather/createWeatherSystem.ts');
const { RAIN_LOOK } = await vite.ssrLoadModule('/src/weather/rainSettings.ts');
const { GROUND_HEIGHT, GROUND_SIZE, VOID_COLOR } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

function fixture(t) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID_COLOR);
  const character = createCharacter();
  character.position.y = GROUND_HEIGHT;
  scene.add(character);
  const { windows, extraEmissives, splashExclusions } = createFarmLayout(scene);
  const { camera, follow, resize } = createIsometricCamera();
  resize(1280, 720);
  follow(character.position);
  const cycle = createDayNightCycle({ scene, character, windows, extraEmissives });
  let seed = 0x12345678;
  let suppressSpawns = false;
  function random() {
    if (suppressSpawns) return 0.99;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
  const weather = createWeatherSystem({
    scene, camera, anchor: character, groundHeight: GROUND_HEIGHT, groundSize: GROUND_SIZE, splashExclusions,
    setDirectionalIntensityMultiplier: cycle.setDirectionalIntensityMultiplier,
    setAmbientHemisphereColorMultiplier: cycle.setAmbientHemisphereColorMultiplier,
    setShadowWeather: cycle.setShadowWeather, random,
  });
  t.after(weather.dispose);
  const streaks = scene.getObjectByName('rain-streaks');
  const splashes = Array.from({ length: 6 }, (_, i) => scene.getObjectByName(`rain-splash-${i + 1}`));
  return {
    scene, character, camera, follow, cycle, weather, windows, streaks, splashes,
    directional: scene.getObjectByName('day-night-directional'),
    ambient: scene.getObjectByName('day-night-ambient'),
    hemisphere: scene.getObjectByName('day-night-hemisphere'),
    lantern: character.getObjectByName('lantern-light'),
    stopNewSplashes: () => { suppressSpawns = true; },
  };
}

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function streakLength(positions, index) {
  return Math.hypot(
    positions.getX(index + 1) - positions.getX(index),
    positions.getY(index + 1) - positions.getY(index),
    positions.getZ(index + 1) - positions.getZ(index),
  );
}

function lightingSnapshot({ scene, ambient, hemisphere, directional, windows, lantern, character }) {
  return {
    sky: scene.background.toArray(),
    fog: scene.fog.color.toArray(),
    fogDensity: scene.fog.density,
    ambient: ambient.color.toArray(),
    ambientIntensity: ambient.intensity,
    hemisphereSky: hemisphere.color.toArray(),
    hemisphereGround: hemisphere.groundColor.toArray(),
    hemisphereIntensity: hemisphere.intensity,
    directional: directional.color.toArray(),
    directionalIntensity: directional.intensity,
    windows: windows.map((pane) => {
      const light = pane.children.find((child) => child.isPointLight);
      return [light.color.getHex(), light.intensity, pane.material.emissive.getHex(), pane.material.emissiveIntensity];
    }),
    lantern: [lantern.color.getHex(), lantern.intensity,
      character.getObjectByName('lantern-glass').material.emissiveIntensity],
  };
}

function isCooler(actual, original) {
  return actual[2] / actual[0] > original[2] / original[0];
}

test('clear and rain blend smoothly and reverse without a jump', (t) => {
  const { cycle, weather, directional, streaks } = fixture(t);
  cycle.setDayNightPhase('daytime');
  assert.deepEqual(weather.getWeather(), { mode: 'clear', rainAmount: 0, cloudyAmount: 0 });
  assert.equal(streaks.visible, false);
  near(directional.intensity, 1.8);

  weather.setWeather('rain');
  weather.update(0.875);
  near(weather.getWeather().rainAmount, 0.5);
  near(streaks.material.opacity, 0.275);
  near(directional.intensity, 1.8 * 0.85);
  weather.setWeather('clear');
  weather.update(0);
  near(weather.getWeather().rainAmount, 0.5);
  weather.update(0.4375);
  assert.ok(weather.getWeather().rainAmount > 0 && weather.getWeather().rainAmount < 0.5);
  weather.update(0.4375);
  near(weather.getWeather().rainAmount, 0);
  near(directional.intensity, 1.8);
  assert.equal(streaks.visible, false);

  weather.setWeather('rain');
  weather.update(1.75);
  near(weather.getWeather().rainAmount, 1);
  near(streaks.material.opacity, 0.55);
  near(directional.intensity, 1.8 * 0.7);
  weather.setWeather('clear');
  weather.update(1.75);
  near(directional.intensity, 1.8);
  assert.throws(() => weather.setWeather('storm'), RangeError);
  assert.throws(() => weather.update(-1), RangeError);
  assert.throws(() => weather.update(Infinity), RangeError);
});

test('cloudy and rain fade the shadow length and opacity with the same weather envelope', (t) => {
  const { character, cycle, weather } = fixture(t);
  const shadow = character.getObjectByName('character-shadow');
  cycle.setDayNightPhase('daytime');
  const horizontalOffset = () => Math.hypot(shadow.position.x, shadow.position.z);
  near(horizontalOffset(), 0.266);
  near(shadow.material.opacity, 0.22);
  weather.setWeather('cloudy');
  weather.update(1.75);
  near(horizontalOffset(), 0.266 * 0.5);
  near(shadow.material.opacity, 0.22 * 0.5);
  weather.setWeather('rain');
  weather.update(1.75);
  near(horizontalOffset(), 0.266 * 0.49);
  near(shadow.material.opacity, 0.22 * 0.2);
  weather.setWeather('clear');
  weather.update(1.75);
  near(horizontalOffset(), 0.266);
  near(shadow.material.opacity, 0.22);
  assert.throws(() => cycle.setShadowWeather(0.8, 0.8), RangeError);
});

test('rain tracks all current phases without accumulating or changing practical lights', (t) => {
  const { scene, cycle, weather, directional, ambient, windows, lantern } = fixture(t);
  const hemisphere = scene.getObjectByName('day-night-hemisphere');
  const phases = [
    ['morning', 2.35, 0xffe8c8, 0xf0e0d0],
    ['daytime', 1.8, 0xfff2d6, 0xe8f0e8],
    ['sunset', 1.2, 0xffeddb, 0xeadbc8],
    ['night', 0.52, 0xc8d4f0, 0xaeb8c9],
  ];
  for (const [phase, intensity, color, ambientColor] of phases) {
    cycle.setDayNightPhase(phase);
    const sky = scene.background.getHex();
    const environment = [scene.fog.color.getHex(), scene.fog.density, ambient.intensity,
      hemisphere.color.getHex(), hemisphere.groundColor.getHex(), hemisphere.intensity];
    weather.setWeather('rain');
    weather.update(1.75);
    for (let i = 0; i < 5; i++) {
      weather.update(0.1);
      near(directional.intensity, intensity * 0.7);
    }
    assert.equal(scene.background.getHex(), sky);
    assert.equal(directional.color.getHex(), color);
    assert.equal(ambient.color.getHex(), ambientColor);
    assert.deepEqual([scene.fog.color.getHex(), scene.fog.density, hemisphere.color.getHex(), hemisphere.groundColor.getHex()],
      [environment[0], environment[1], environment[3], environment[4]]);
    near(ambient.intensity, environment[2] * (phase === 'night' ? 0.8 : 1));
    near(hemisphere.intensity, environment[5] * (phase === 'night' ? 0.8 : 1));
    for (const pane of windows) {
      const light = pane.children.find((child) => child.isPointLight);
      assert.equal(light.color.getHex(), 0xffcc88);
      near(light.intensity, phase === 'night' ? 0.85 : 0);
    }
    near(lantern.intensity, phase === 'night' ? 0.12 : 0);
    weather.setWeather('clear');
    weather.update(1.75);
    near(directional.intensity, intensity);
  }

  cycle.setDayNightPhase('sunset');
  weather.setWeather('rain');
  weather.update(1.75);
  cycle.update(9); // Halfway between sunset and night.
  near(directional.intensity, ((1.2 + 0.52) / 2) * 0.7);
  near(windows[0].children.find((child) => child.isPointLight).intensity, 0.425);
  weather.setWeather('clear');
  weather.update(1.75);
  near(directional.intensity, (1.2 + 0.52) / 2);
  assert.throws(() => cycle.setDirectionalIntensityMultiplier(-0.1), RangeError);
  assert.throws(() => cycle.setDirectionalIntensityMultiplier(NaN), RangeError);
  assert.throws(() => cycle.setDirectionalIntensityMultiplier(1.1), RangeError);
});

test('cloudy softens and cools every phase while preserving the environment and warm practical lights', (t) => {
  const farm = fixture(t);
  const { cycle, weather, streaks, splashes } = farm;
  for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
    cycle.setDayNightPhase(phase);
    const clear = lightingSnapshot(farm);
    weather.setWeather('cloudy');
    weather.update(1.75);
    assert.deepEqual(weather.getWeather(), { mode: 'cloudy', rainAmount: 0, cloudyAmount: 1 });
    const cloudy = lightingSnapshot(farm);
    assert.ok(cloudy.directionalIntensity > 0 && cloudy.directionalIntensity < clear.directionalIntensity, phase);
    near(cloudy.directionalIntensity, clear.directionalIntensity * 0.72);
    assert.ok(isCooler(cloudy.ambient, clear.ambient), `ambient not cooler in ${phase}`);
    assert.ok(isCooler(cloudy.hemisphereSky, clear.hemisphereSky), `hemisphere sky not cooler in ${phase}`);
    assert.ok(isCooler(cloudy.hemisphereGround, clear.hemisphereGround), `hemisphere ground not cooler in ${phase}`);
    for (const key of ['ambient', 'hemisphereSky', 'hemisphereGround']) {
      cloudy[key].forEach((value, i) => near(value, clear[key][i] * [0.86, 0.96, 1.08][i]));
    }
    for (const key of ['sky', 'fog', 'fogDensity', 'directional', 'windows', 'lantern']) {
      assert.deepEqual(cloudy[key], clear[key], `${key} changed in ${phase}`);
    }
    near(cloudy.ambientIntensity, clear.ambientIntensity * (phase === 'night' ? 0.82 : 1));
    near(cloudy.hemisphereIntensity, clear.hemisphereIntensity * (phase === 'night' ? 0.82 : 1));
    assert.equal(streaks.visible, false);
    assert.ok(splashes.every((splash) => !splash.visible));
    for (let i = 0; i < 20; i++) weather.update(1 / 60);
    assert.deepEqual(lightingSnapshot(farm), cloudy, `cloudy lighting accumulated in ${phase}`);
    weather.setWeather('clear');
    weather.update(1.75);
    assert.deepEqual(lightingSnapshot(farm), clear, `clear did not exactly restore ${phase}`);
  }
});

test('the sun or moon remains stronger than the flat fill in every phase and weather', (t) => {
  const { cycle, weather, ambient, hemisphere, directional } = fixture(t);
  for (const mode of ['clear', 'cloudy', 'rain', 'snow']) {
    weather.setWeather(mode);
    weather.update(1.75);
    for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
      cycle.setDayNightPhase(phase);
      assert.ok(ambient.intensity + hemisphere.intensity < directional.intensity, `${phase}/${mode}: fill overpowered key`);
    }
    for (let i = 0; i < 128; i++) {
      cycle.update(72 / 128);
      assert.ok(ambient.intensity + hemisphere.intensity < directional.intensity, `${mode}: fill overpowered key between phases`);
    }
  }
});

test('clear and cloudy blend smoothly and can reverse without a lighting jump', (t) => {
  const farm = fixture(t);
  const { cycle, weather } = farm;
  cycle.setDayNightPhase('daytime');
  const clear = lightingSnapshot(farm);
  weather.setWeather('cloudy');
  weather.update(1.75);
  const cloudy = lightingSnapshot(farm);
  weather.setWeather('clear');
  weather.update(1.75);
  weather.setWeather('cloudy');
  weather.update(0.875);
  near(weather.getWeather().cloudyAmount, 0.5);
  const halfway = lightingSnapshot(farm);
  near(halfway.directionalIntensity, (clear.directionalIntensity + cloudy.directionalIntensity) / 2);
  for (const key of ['ambient', 'hemisphereSky', 'hemisphereGround']) {
    halfway[key].forEach((value, i) => near(value, (clear[key][i] + cloudy[key][i]) / 2));
  }
  weather.setWeather('clear');
  weather.update(0);
  assert.deepEqual(lightingSnapshot(farm), halfway);
  weather.update(0.4375);
  near(weather.getWeather().cloudyAmount, 0.15625);
  const reversed = lightingSnapshot(farm);
  assert.ok(reversed.directionalIntensity > halfway.directionalIntensity && reversed.directionalIntensity < clear.directionalIntensity);
  assert.ok(isCooler(reversed.ambient, clear.ambient));
  weather.setWeather('cloudy');
  weather.update(0);
  assert.deepEqual(lightingSnapshot(farm), reversed);
  weather.update(1.75);
  assert.deepEqual(lightingSnapshot(farm), cloudy);
});

test('rain and cloudy crossfade continuously, preserve particles and reverse midway', (t) => {
  const farm = fixture(t);
  const { cycle, weather, directional, streaks, splashes } = farm;
  cycle.setDayNightPhase('daytime');
  weather.setWeather('rain');
  weather.update(1.75);
  let splash;
  for (let frame = 0; frame < 1800 && !splash; frame++) {
    weather.update(1 / 60);
    splash = splashes.find((ring) => ring.visible);
  }
  assert.ok(splash, 'no rain splash appeared');
  const geometry = streaks.geometry;
  const positionBefore = geometry.attributes.position.array.slice();
  const rainLighting = lightingSnapshot(farm);
  weather.setWeather('cloudy');
  assert.deepEqual(weather.getWeather(), { mode: 'cloudy', rainAmount: 1, cloudyAmount: 0 });
  weather.update(0);
  assert.deepEqual(lightingSnapshot(farm), rainLighting);
  assert.ok(positionBefore.every((value, index) =>
    Math.abs(value - geometry.attributes.position.array[index]) < 1e-5), 'rain particles jumped on mode change');
  assert.equal(splash.visible, true);
  weather.update(0.05);
  assert.equal(splash.visible, true, 'an existing splash should not be discarded on mode change');
  assert.ok(weather.getWeather().rainAmount < 1 && weather.getWeather().rainAmount > 0);
  assert.ok(weather.getWeather().cloudyAmount > 0);
  near(streaks.material.opacity, 0.55 * weather.getWeather().rainAmount);
  const midway = weather.getWeather();
  const midwayLighting = lightingSnapshot(farm);
  weather.setWeather('rain');
  weather.update(0);
  near(weather.getWeather().rainAmount, midway.rainAmount);
  near(weather.getWeather().cloudyAmount, midway.cloudyAmount);
  assert.deepEqual(lightingSnapshot(farm), midwayLighting);
  weather.update(1.75);
  assert.deepEqual(weather.getWeather(), { mode: 'rain', rainAmount: 1, cloudyAmount: 0 });
  near(directional.intensity, 1.8 * 0.7);

  weather.setWeather('cloudy');
  weather.update(0.875);
  near(weather.getWeather().rainAmount, 0.5);
  near(weather.getWeather().cloudyAmount, 0.5);
  assert.equal(streaks.visible, true);
  weather.update(0.875);
  assert.deepEqual(weather.getWeather(), { mode: 'cloudy', rainAmount: 0, cloudyAmount: 1 });
  assert.equal(streaks.visible, false);
  assert.ok(splashes.every((ring) => !ring.visible));
  const stoppedPositions = geometry.attributes.position.array.slice();
  weather.setWeather('rain');
  weather.update(0.35);
  assert.ok(weather.getWeather().rainAmount > 0 && weather.getWeather().cloudyAmount < 1);
  assert.equal(streaks.visible, true);
  assert.equal(streaks.geometry, geometry);
  assert.ok(stoppedPositions.some((value, index) =>
    Math.abs(value - geometry.attributes.position.array[index]) > 0.01), 'rain particles did not resume');
});

test('rapid weather reversals follow the moving phase and clear restores its exact lighting', (t) => {
  const farm = fixture(t);
  const reference = fixture(t);
  farm.cycle.setDayNightPhase('sunset');
  reference.cycle.setDayNightPhase('sunset');
  for (let i = 0; i < 120; i++) {
    if (i % 7 === 0) farm.weather.setWeather(['cloudy', 'rain', 'snow', 'clear'][(i / 7) % 4]);
    const before = farm.weather.getWeather();
    farm.weather.update(0);
    assert.deepEqual(farm.weather.getWeather(), before);
    farm.cycle.update(0.13);
    reference.cycle.update(0.13);
    farm.weather.update(0.13);
    const { rainAmount, cloudyAmount } = farm.weather.getWeather();
    const snowAmount = farm.weather.getSnowAmount();
    assert.ok(rainAmount >= 0 && cloudyAmount >= 0 && snowAmount >= 0 && rainAmount + cloudyAmount + snowAmount <= 1 + 1e-12);
    assert.ok(farm.directional.intensity <= reference.directional.intensity + 1e-12);
  }
  farm.weather.setWeather('clear');
  farm.cycle.update(1.75);
  reference.cycle.update(1.75);
  farm.weather.update(1.75);
  assert.deepEqual(farm.weather.getWeather(), { mode: 'clear', rainAmount: 0, cloudyAmount: 0 });
  assert.deepEqual(lightingSnapshot(farm), lightingSnapshot(reference));
  for (const invalid of ['storm', '', null, undefined, 1]) {
    assert.throws(() => farm.weather.setWeather(invalid), RangeError);
    assert.equal(farm.weather.getWeather().mode, 'clear');
  }
});

test('disposing cloudy restores current-phase colors and intensity', (t) => {
  const farm = fixture(t);
  farm.cycle.setDayNightPhase('night');
  farm.cycle.update(4.5);
  const clear = lightingSnapshot(farm);
  farm.weather.setWeather('cloudy');
  farm.weather.update(1.75);
  assert.notDeepEqual(lightingSnapshot(farm).ambient, clear.ambient);
  farm.weather.dispose();
  assert.deepEqual(lightingSnapshot(farm), clear);
  assert.equal(farm.scene.getObjectByName('weather-rain'), undefined);
  farm.weather.dispose();
  for (const values of [[NaN, 1, 1], [1, Infinity, 1], [1, 1, -0.1]]) {
    assert.throws(() => farm.cycle.setAmbientHemisphereColorMultiplier(...values), RangeError);
  }
  assert.deepEqual(lightingSnapshot(farm), clear);
});

test('rain look keeps the specified field, tint, budget and fall speeds', () => {
  assert.deepEqual({
    count: RAIN_LOOK.streakCount,
    length: [RAIN_LOOK.streakLengthMin, RAIN_LOOK.streakLengthMax],
    tilt: RAIN_LOOK.streakTiltDegrees,
    direction: [RAIN_LOOK.streakDirectionX, RAIN_LOOK.streakDirectionZ],
    field: [RAIN_LOOK.fieldWidth, RAIN_LOOK.fieldWidth, RAIN_LOOK.fieldHeight],
    color: RAIN_LOOK.color,
    opacity: RAIN_LOOK.opacity,
    speed: [RAIN_LOOK.fallSpeedMin, RAIN_LOOK.fallSpeedMax],
  }, {
    count: 240, length: [0.4, 0.6], tilt: 15, direction: [0.94, -0.34],
    field: [19, 19, 8], color: 0xd6e8f2, opacity: 0.55, speed: [4, 5],
  });
});

test('rain actually fills both horizontal axes and the height with unchanged fall speeds', (t) => {
  const scene = new THREE.Scene();
  const anchor = new THREE.Object3D();
  scene.add(anchor);
  const { camera } = createIsometricCamera();
  let calls = 0;
  const first = [0, 0.5, 0, 0, 0];
  const random = () => {
    const index = calls++;
    return index < 5 ? first[index] : index < 10 ? 0.9999 : 0.5;
  };
  const rain = createRainEffect({ scene, camera, anchor, groundHeight: 0, groundSize: 16, splashExclusions: [], random });
  t.after(rain.dispose);
  rain.update(0, 1);
  const positions = scene.getObjectByName('rain-streaks').geometry.attributes.position;
  near(positions.getX(0), -9.5, 1e-5);
  near(positions.getZ(0), -9.5, 1e-5);
  near(positions.getY(0), 4, 1e-5);
  near(positions.getX(2), 9.4981, 1e-5);
  near(positions.getZ(2), 9.4981, 1e-5);
  near(positions.getY(2), 7.9992, 1e-5);
  near(streakLength(positions, 0), 0.4, 1e-5);
  near(streakLength(positions, 2), 0.59998, 1e-5);
  const tops = [positions.getY(0), positions.getY(2), positions.getY(4)];
  const center = [positions.getX(4), positions.getZ(4)];
  rain.update(0.1, 1);
  near((tops[0] - positions.getY(0)) / 0.1, 4, 1e-5);
  near((tops[1] - positions.getY(2)) / 0.1, 4.9999, 1e-5);
  near((tops[2] - positions.getY(4)) / 0.1, 4.5, 1e-5);
  const dx = positions.getX(4) - center[0];
  const dz = positions.getZ(4) - center[1];
  assert.ok(dx > 0 && dz < 0, 'fall moves toward +X and -Z');
  near(dx / Math.hypot(dx, dz), 0.94 / Math.hypot(0.94, 0.34), 1e-5);
  near(dz / Math.hypot(dx, dz), -0.34 / Math.hypot(0.94, 0.34), 1e-5);
});

test('rain is readable, one pixel wide and tilts lower-right toward the specified world direction', (t) => {
  const { scene, camera, character, follow, weather, streaks } = fixture(t);
  weather.setWeather('rain');
  weather.update(1.75);
  assert.equal(streaks.isLineSegments, true);
  assert.equal(streaks.material.color.getHex(), 0xd6e8f2);
  near(streaks.material.opacity, 0.55);
  assert.equal(streaks.material.linewidth, 1);
  const positions = streaks.geometry.attributes.position;
  assert.equal(positions.count, 480);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  for (let i = 0; i < positions.count; i += 2) {
    const top = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)).project(camera);
    const bottom = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i + 1)).project(camera);
    const dx = (bottom.x - top.x) * 1280 / 2;
    const dy = (top.y - bottom.y) * 720 / 2;
    assert.ok(dx > 0 && dy > 0, 'each streak leans down and right on screen');
    near(Math.atan2(dx, dy) * 180 / Math.PI, 15, 0.01);
    assert.ok(Math.hypot(dx, dy) >= 12.6 && Math.hypot(dx, dy) <= 19.2);
    assert.ok(streakLength(positions, i) >= 0.4 - 1e-6);
    assert.ok(streakLength(positions, i) <= 0.6 + 1e-6);
    assert.ok(Math.abs(positions.getX(i)) <= 9.5 && Math.abs(positions.getZ(i)) <= 9.5);
    assert.ok(positions.getY(i) >= 0 && positions.getY(i) <= 8);
    const worldX = positions.getX(i + 1) - positions.getX(i);
    const worldZ = positions.getZ(i + 1) - positions.getZ(i);
    near(worldX / Math.hypot(worldX, worldZ), 0.94 / Math.hypot(0.94, 0.34), 2e-5);
    near(worldZ / Math.hypot(worldX, worldZ), -0.34 / Math.hypot(0.94, 0.34), 2e-5);
  }
  const beforeMove = Array.from({ length: positions.count / 2 }, (_, index) =>
    streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index * 2)));
  const before = beforeMove[0];
  character.position.x += 1;
  follow(character.position);
  weather.update(0);
  scene.updateMatrixWorld(true);
  for (let index = 0; index < beforeMove.length; index++) {
    const after = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, index * 2));
    const dx = after.x - beforeMove[index].x;
    // The field wraps only at its edge; the other drops stay in world space.
    near(dx, Math.round(dx / 19) * 19, 1e-5);
    near(after.y, beforeMove[index].y, 1e-5);
    near(after.z, beforeMove[index].z, 1e-5);
  }
  const afterMove = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, 0));
  near(before.distanceTo(afterMove), 0, 1e-5);
  weather.update(0.1);
  const afterRain = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, 0));
  assert.ok(before.distanceTo(afterRain) > 0.1);
});

test('rain follows engine-controlled movement without dragging world-space streaks', (t) => {
  function running() {
    const farm = fixture(t);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), new THREE.MeshBasicMaterial());
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
    let frame;
    const engine = createEngine({
      setAnimationLoop: (callback) => { frame = callback; },
      frameSystems: [(world, move, delta) => controller.system(world, move, Math.min(delta, 0.1))],
      update(delta) { farm.follow(farm.character.position); farm.weather.update(delta); },
      render() {},
    });
    const controller = createCharacterController({
      world: engine.world, input: engine.input, character: farm.character, camera: farm.camera, canvas, ground,
      groundSize: GROUND_SIZE, groundHeight: GROUND_HEIGHT, characterRadius: 0.4,
    });
    t.after(() => { engine.stop(); controller.dispose(); ground.geometry.dispose(); ground.material.dispose(); });
    farm.weather.setWeather('rain');
    engine.start();
    return { ...farm, engine, tick: (time) => frame(time) };
  }

  const moving = running();
  const stationary = running();
  for (const farm of [moving, stationary]) { farm.tick(0); farm.tick(1750); }
  moving.engine.input.keyDown({ code: 'KeyS', target: null });
  for (let frame = 1; frame <= 8; frame++) {
    moving.tick(1750 + frame * 100);
    stationary.tick(1750 + frame * 100);
    near(moving.streaks.parent.position.x, moving.character.position.x, 1e-8);
    near(moving.streaks.parent.position.z, moving.character.position.z, 1e-8);
    const movingPositions = moving.streaks.geometry.attributes.position;
    const stationaryPositions = stationary.streaks.geometry.attributes.position;
    for (let i = 0; i < movingPositions.count; i++) {
      const a = moving.streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(movingPositions, i));
      const b = stationary.streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(stationaryPositions, i));
      const dx = a.x - b.x;
      const dz = a.z - b.z;
      near(dx, Math.round(dx / 19) * 19, 1e-5);
      near(dz, Math.round(dz / 19) * 19, 1e-5);
      near(a.y, b.y, 1e-5);
    }
  }
  assert.ok(Math.hypot(moving.character.position.x, moving.character.position.z) > 1);
  near(stationary.character.position.x, 0);
  near(stationary.character.position.z, 0);
});

test('splash rings are occasional, short-lived and avoid buildings, water and ground edges', (t) => {
  const { scene, character, weather, splashes, stopNewSplashes } = fixture(t);
  scene.updateMatrixWorld(true);
  const buildings = ['cottage', 'ramp-coop-1', 'ramp-coop-2']
    .map((name) => new THREE.Box3().setFromObject(scene.getObjectByName(`${name}-roof`)));
  weather.setWeather('rain');
  weather.update(1.75);
  let sawSplash = false;
  for (let frame = 0; frame < 1800; frame++) {
    if (frame === 900) character.position.set(7.5, GROUND_HEIGHT, 7.5);
    weather.update(1 / 60);
    const visible = splashes.filter((splash) => splash.visible);
    assert.ok(visible.length <= 6);
    for (const splash of visible) {
      sawSplash = true;
      const radius = splash.scale.x;
      assert.ok(radius >= 0.08 && radius <= 0.18);
      assert.ok(splash.material.opacity > 0 && splash.material.opacity <= 0.32);
      assert.ok(Math.abs(splash.position.x) + radius < 8 && Math.abs(splash.position.z) + radius < 8);
      near(splash.position.y, GROUND_HEIGHT + 0.036);
      for (const building of buildings) {
        const nearestX = THREE.MathUtils.clamp(splash.position.x, building.min.x, building.max.x);
        const nearestZ = THREE.MathUtils.clamp(splash.position.z, building.min.z, building.max.z);
        assert.ok(Math.hypot(splash.position.x - nearestX, splash.position.z - nearestZ) > radius, 'splash crossed a building');
      }
      // Pond water's bounding rectangle is kept clear of new ripples.
      const pondX = THREE.MathUtils.clamp(splash.position.x, 2.3725, 5.6275);
      const pondZ = THREE.MathUtils.clamp(splash.position.z, -4.4975, -2.5025);
      assert.ok(Math.hypot(splash.position.x - pondX, splash.position.z - pondZ) > radius, 'splash crossed the pond');
    }
  }
  assert.ok(sawSplash, 'no ground splash appeared');

  // Start a fresh ring, then suppress new impacts to observe its complete fade.
  weather.update(0.6);
  let ring;
  for (let frame = 0; frame < 1800 && !ring; frame++) {
    weather.update(1 / 60);
    ring = splashes.find((splash) => splash.visible);
  }
  assert.ok(ring, 'no fresh splash appeared');
  near(ring.scale.x, 0.08);
  stopNewSplashes();
  let elapsed = 0;
  let previousOpacity = ring.material.opacity;
  while (ring.visible && elapsed < 0.5) {
    weather.update(0.01);
    elapsed += 0.01;
    if (ring.visible) {
      assert.ok(ring.material.opacity < previousOpacity);
      assert.ok(ring.scale.x >= 0.08 && ring.scale.x <= 0.18);
      previousOpacity = ring.material.opacity;
    }
  }
  assert.ok(elapsed >= 0.25 && elapsed <= 0.41, `splash lasted ${elapsed} seconds`);
  weather.setWeather('clear');
  weather.update(1.75);
  assert.ok(splashes.every((splash) => !splash.visible));
});

test('disposing rain restores the current phase intensity and removes the effect', (t) => {
  const { scene, cycle, weather, directional } = fixture(t);
  cycle.setDayNightPhase('night');
  weather.setWeather('rain');
  weather.update(1.75);
  near(directional.intensity, 0.52 * 0.7);
  weather.dispose();
  near(directional.intensity, 0.52);
  assert.equal(scene.getObjectByName('weather-rain'), undefined);
});
