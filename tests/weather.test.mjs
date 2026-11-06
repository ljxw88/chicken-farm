import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { createWeatherSystem } = await vite.ssrLoadModule('/src/weather/createWeatherSystem.ts');
after(() => vite.close());

function fixture(t) {
  const scene = new THREE.Scene();
  const character = createCharacter();
  scene.add(character);
  const { windows, splashExclusions } = createFarmLayout(scene);
  const { camera, follow, resize } = createIsometricCamera();
  resize(1280, 720);
  const cycle = createDayNightCycle({ scene, character, windows });
  let seed = 0x12345678;
  let suppressSpawns = false;
  function random() {
    if (suppressSpawns) return 0.99;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
  const weather = createWeatherSystem({
    scene, camera, anchor: character, groundHeight: 0, groundSize: 32, splashExclusions,
    setDirectionalIntensityMultiplier: cycle.setDirectionalIntensityMultiplier, random,
  });
  t.after(weather.dispose);
  const streaks = scene.getObjectByName('rain-streaks');
  const splashes = Array.from({ length: 6 }, (_, i) => scene.getObjectByName(`rain-splash-${i + 1}`));
  return {
    scene, character, camera, follow, cycle, weather, windows, streaks, splashes,
    directional: scene.getObjectByName('day-night-directional'),
    ambient: scene.getObjectByName('day-night-ambient'),
    lantern: character.getObjectByName('lantern-light'),
    stopNewSplashes: () => { suppressSpawns = true; },
  };
}

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

test('clear and rain blend smoothly and reverse without a jump', (t) => {
  const { cycle, weather, directional, streaks } = fixture(t);
  cycle.setDayNightPhase('daytime');
  assert.deepEqual(weather.getWeather(), { mode: 'clear', rainAmount: 0 });
  assert.equal(streaks.visible, false);
  near(directional.intensity, 1.1);

  weather.setWeather('rain');
  weather.update(0.875);
  near(weather.getWeather().rainAmount, 0.5);
  near(streaks.material.opacity, 0.175);
  near(directional.intensity, 1.1 * 0.9);
  weather.setWeather('clear');
  weather.update(0);
  near(weather.getWeather().rainAmount, 0.5);
  weather.update(0.4375);
  assert.ok(weather.getWeather().rainAmount > 0 && weather.getWeather().rainAmount < 0.5);
  weather.update(0.4375);
  near(weather.getWeather().rainAmount, 0);
  near(directional.intensity, 1.1);
  assert.equal(streaks.visible, false);

  weather.setWeather('rain');
  weather.update(1.75);
  near(weather.getWeather().rainAmount, 1);
  near(streaks.material.opacity, 0.35);
  near(directional.intensity, 1.1 * 0.8);
  weather.setWeather('clear');
  weather.update(1.75);
  near(directional.intensity, 1.1);
  assert.throws(() => weather.setWeather('storm'), RangeError);
  assert.throws(() => weather.update(-1), RangeError);
  assert.throws(() => weather.update(Infinity), RangeError);
});

test('rain tracks all current phases without accumulating or changing practical lights', (t) => {
  const { scene, cycle, weather, directional, ambient, windows, lantern } = fixture(t);
  const hemisphere = scene.getObjectByName('day-night-hemisphere');
  const phases = [
    ['morning', 0.55, 0xffe8c8, 0xf0e0d0],
    ['daytime', 1.1, 0xfff2d6, 0xe8f0e8],
    ['sunset', 0.65, 0xff8a50, 0xe89870],
    ['night', 0.22, 0xc8d4f0, 0x3a4560],
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
      near(directional.intensity, intensity * 0.8);
    }
    assert.equal(scene.background.getHex(), sky);
    assert.equal(directional.color.getHex(), color);
    assert.equal(ambient.color.getHex(), ambientColor);
    assert.deepEqual([scene.fog.color.getHex(), scene.fog.density, ambient.intensity,
      hemisphere.color.getHex(), hemisphere.groundColor.getHex(), hemisphere.intensity], environment);
    for (const pane of windows) {
      const light = pane.children.find((child) => child.isPointLight);
      assert.equal(light.color.getHex(), 0xffcc88);
      near(light.intensity, phase === 'night' ? 0.85 : 0);
    }
    near(lantern.intensity, phase === 'night' ? 0.55 : 0);
    weather.setWeather('clear');
    weather.update(1.75);
    near(directional.intensity, intensity);
  }

  cycle.setDayNightPhase('sunset');
  weather.setWeather('rain');
  weather.update(1.75);
  cycle.update(9); // Halfway between sunset and night.
  near(directional.intensity, ((0.65 + 0.22) / 2) * 0.8);
  near(windows[0].children.find((child) => child.isPointLight).intensity, 0.425);
  weather.setWeather('clear');
  weather.update(1.75);
  near(directional.intensity, (0.65 + 0.22) / 2);
  assert.throws(() => cycle.setDirectionalIntensityMultiplier(-0.1), RangeError);
  assert.throws(() => cycle.setDirectionalIntensityMultiplier(NaN), RangeError);
  assert.throws(() => cycle.setDirectionalIntensityMultiplier(1.1), RangeError);
});

test('rain is sparse, short, unblurred and tilted 15 degrees on screen', (t) => {
  const { scene, camera, character, follow, weather, streaks } = fixture(t);
  weather.setWeather('rain');
  weather.update(1.75);
  assert.equal(streaks.isLineSegments, true);
  assert.equal(streaks.material.color.getHex(), 0xb8cfda);
  assert.ok(streaks.material.opacity >= 0.3 && streaks.material.opacity <= 0.4);
  assert.equal(streaks.material.linewidth, 1);
  const positions = streaks.geometry.attributes.position;
  assert.ok(positions.count > 0 && positions.count <= 600);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  for (let i = 0; i < positions.count; i += 2) {
    const top = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i)).project(camera);
    const bottom = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i + 1)).project(camera);
    const dx = (bottom.x - top.x) * 1280 / 2;
    const dy = (top.y - bottom.y) * 720 / 2;
    near(Math.atan2(Math.abs(dx), Math.abs(dy)) * 180 / Math.PI, 15, 0.01);
    assert.ok(Math.hypot(dx, dy) >= 3 && Math.hypot(dx, dy) <= 5.1);
  }
  const before = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, 0));
  character.position.x += 1;
  follow(character.position);
  weather.update(0);
  scene.updateMatrixWorld(true);
  const afterMove = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, 0));
  near(before.distanceTo(afterMove), 0, 1e-5);
  weather.update(0.1);
  const afterRain = streaks.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, 0));
  assert.ok(before.distanceTo(afterRain) > 0.1);
});

test('splash rings are occasional, short-lived and avoid roofs, water and ground edges', (t) => {
  const { scene, character, weather, splashes, stopNewSplashes } = fixture(t);
  scene.updateMatrixWorld(true);
  const roof = new THREE.Box3();
  for (const object of scene.getObjectByName('farm-barn').children.filter((child) => child.name === 'barn-roof')) {
    roof.union(new THREE.Box3().setFromObject(object));
  }
  weather.setWeather('rain');
  weather.update(1.75);
  let sawSplash = false;
  for (let frame = 0; frame < 1800; frame++) {
    if (frame === 900) character.position.set(15.5, 0, 15.5);
    weather.update(1 / 60);
    const visible = splashes.filter((splash) => splash.visible);
    assert.ok(visible.length <= 6);
    for (const splash of visible) {
      sawSplash = true;
      const radius = splash.scale.x;
      assert.ok(radius >= 0.08 && radius <= 0.18);
      assert.ok(splash.material.opacity > 0 && splash.material.opacity <= 0.32);
      assert.ok(Math.abs(splash.position.x) + radius < 16 && Math.abs(splash.position.z) + radius < 16);
      const nearestX = THREE.MathUtils.clamp(splash.position.x, roof.min.x, roof.max.x);
      const nearestZ = THREE.MathUtils.clamp(splash.position.z, roof.min.z, roof.max.z);
      assert.ok(Math.hypot(splash.position.x - nearestX, splash.position.z - nearestZ) > radius, 'splash crossed a roof');
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
  near(directional.intensity, 0.22 * 0.8);
  weather.dispose();
  near(directional.intensity, 0.22);
  assert.equal(scene.getObjectByName('weather-rain'), undefined);
});
