import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createSnow, SNOW_LOOK } = await vite.ssrLoadModule('/src/weather/createSnow.ts');
const { createWeatherSystem } = await vite.ssrLoadModule('/src/weather/createWeatherSystem.ts');
const { createVisualRandom } = await vite.ssrLoadModule('/src/effects/createVisualRandom.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
after(() => vite.close());

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

function snowFixture(t, random = createVisualRandom(123)) {
  const scene = new THREE.Scene();
  const anchor = new THREE.Group();
  scene.add(anchor);
  const { camera } = createIsometricCamera();
  const snow = createSnow({ scene, camera, anchor, groundHeight: 2.4, random });
  t.after(snow.dispose);
  return { scene, anchor, camera, snow, mesh: scene.getObjectByName('snow-flakes') };
}

function flake(mesh, index) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

test('snow uses 160 flat square flakes, the specified field, sizes, color and phase opacity', (t) => {
  const { scene, camera, snow, mesh } = snowFixture(t);
  assert.deepEqual({ field: [SNOW_LOOK.fieldWidth, SNOW_LOOK.fieldWidth, SNOW_LOOK.fieldHeight],
    size: [SNOW_LOOK.sizeMin, SNOW_LOOK.sizeMax], speed: [SNOW_LOOK.fallSpeedMin, SNOW_LOOK.fallSpeedMax],
    sway: [SNOW_LOOK.swayAmplitude, SNOW_LOOK.swayPeriodMin, SNOW_LOOK.swayPeriodMax],
    wind: [SNOW_LOOK.windX, SNOW_LOOK.windZ] }, {
    field: [19, 19, 8], size: [0.11, 0.22], speed: [0.8, 1.4], sway: [0.3, 3, 5], wind: [0.8, -0.6],
  });
  assert.equal(mesh.isInstancedMesh, true);
  assert.equal(mesh.count, 160);
  assert.equal(mesh.geometry.type, 'PlaneGeometry');
  assert.deepEqual([mesh.geometry.parameters.width, mesh.geometry.parameters.height], [1, 1]);
  const color = mesh.material.color.getHex();
  assert.equal(color, 0xf2f6f8);
  assert.ok([color >>> 16, (color >>> 8) & 0xff, color & 0xff].every((channel) => channel < 250));
  assert.equal(mesh.material.transparent, true);
  assert.equal(mesh.material.depthWrite, false);
  assert.equal(scene.getObjectByName('weather-snow').children.length, 1, 'no streaks, splashes or ground pile');

  snow.update(0, 1, 0);
  near(mesh.material.opacity, 0.8);
  assert.equal(mesh.visible, true);
  const sizes = [];
  const rotation = camera.getWorldQuaternion(new THREE.Quaternion());
  for (let i = 0; i < mesh.count; i++) {
    const { position, scale, rotation: actualRotation } = flake(mesh, i);
    assert.ok(scale.x >= 0.11 - 1e-6 && scale.x <= 0.22 + 1e-6);
    near(scale.x, scale.y);
    assert.ok(Math.abs(position.x) <= 9.5 && Math.abs(position.z) <= 9.5);
    assert.ok(position.y >= 0 && position.y <= 8);
    near(Math.abs(actualRotation.dot(rotation)), 1);
    sizes.push(scale.x);
  }
  assert.ok(new Set(sizes.map((size) => size.toFixed(4))).size > 50);
  snow.update(0, 1, 0.5);
  near(mesh.material.opacity, 0.68);
  snow.update(0, 1, 1);
  near(mesh.material.opacity, 0.8 * 0.7);
  snow.update(0, 0.25, 1);
  near(mesh.material.opacity, 0.8 * 0.7 * 0.25);
  snow.update(0, 0, 0);
  assert.equal(mesh.visible, false);
});

test('actual flakes fall at the specified speeds and sway gently across the wind', (t) => {
  const high = 0.999999;
  const draws = [0.5, 0.5, 0.5, 0, 0, 0, 0, 0.5, 0.5, 0.5, high, high, high, 0];
  let call = 0;
  const { snow, mesh } = snowFixture(t, () => draws[call++] ?? 0.5);
  snow.update(0, 1, 0);
  const before = [flake(mesh, 0), flake(mesh, 1)];
  near(before[0].scale.x, 0.11);
  near(before[1].scale.x, 0.22, 2e-6);
  snow.update(0.75, 1, 0);
  for (const [index, speed, period] of [[0, 0.8, 3], [1, 0.8 + 0.6 * high, 3 + 2 * high]]) {
    const position = flake(mesh, index).position;
    const delta = position.clone().sub(before[index].position);
    near(-delta.y / 0.75, speed);
    near(delta.x * 0.8 - delta.z * 0.6, speed * 0.75 * 0.12);
    near(delta.x * 0.6 + delta.z * 0.8, 0.3 * Math.sin(0.75 * 2 * Math.PI / period));
  }
  // The shortest period reaches its positive limit at 0.75 s and returns
  // to its center at 1.5 s; it is a sway, not an accelerating drift.
  snow.update(0.75, 1, 0);
  const delta = flake(mesh, 0).position.sub(before[0].position);
  near(delta.x * 0.6 + delta.z * 0.8, 0);
  near(delta.x * 0.8 - delta.z * 0.6, 0.8 * 1.5 * 0.12);
});

test('seeded flakes replay exactly and the following field does not drag them with the player', (t) => {
  const a = snowFixture(t, createVisualRandom(123));
  const b = snowFixture(t, createVisualRandom(123));
  const c = snowFixture(t, createVisualRandom(124));
  for (const delta of [0, 0.1, 0.4, 1.2, 2.3]) {
    for (const item of [a, b, c]) item.snow.update(delta, 1, 0);
    assert.deepEqual(a.mesh.instanceMatrix.array, b.mesh.instanceMatrix.array);
    assert.notDeepEqual(a.mesh.instanceMatrix.array, c.mesh.instanceMatrix.array);
  }
  const positions = Array.from({ length: 160 }, (_, index) =>
    flake(a.mesh, index).position.add(a.mesh.parent.position));
  a.anchor.position.set(3, 0, -2);
  a.snow.update(0, 1, 0);
  near(a.mesh.parent.position.x, 3);
  near(a.mesh.parent.position.z, -2);
  for (let i = 0; i < 160; i++) {
    const moved = flake(a.mesh, i).position.add(a.mesh.parent.position).sub(positions[i]);
    near(moved.x, Math.round(moved.x / 19) * 19, 2e-6);
    near(moved.y, 0);
    near(moved.z, Math.round(moved.z / 19) * 19, 2e-6);
  }
});

test('snow uses cloudy lighting and shadows, adds only 3% blue, and preserves practicals in every phase', (t) => {
  const scene = new THREE.Scene();
  const character = createCharacter();
  scene.add(character);
  const { windows, extraEmissives, splashExclusions } = createFarmLayout(scene);
  const { camera } = createIsometricCamera();
  const cycle = createDayNightCycle({ scene, character, windows, extraEmissives });
  const weather = createWeatherSystem({ scene, camera, anchor: character, groundHeight: 0, groundSize: 16,
    splashExclusions, random: createVisualRandom(123), setDirectionalIntensityMultiplier: cycle.setDirectionalIntensityMultiplier,
    setAmbientHemisphereColorMultiplier: cycle.setAmbientHemisphereColorMultiplier, setShadowWeather: cycle.setShadowWeather });
  t.after(weather.dispose);
  const directional = scene.getObjectByName('day-night-directional');
  const ambient = scene.getObjectByName('day-night-ambient');
  const hemisphere = scene.getObjectByName('day-night-hemisphere');
  const lantern = character.getObjectByName('lantern-light');
  const shadow = character.getObjectByName('character-shadow');
  const sample = () => ({
    directional: directional.intensity, ambient: ambient.color.toArray(), sky: hemisphere.color.toArray(),
    ground: hemisphere.groundColor.toArray(), ambientIntensity: ambient.intensity, hemisphereIntensity: hemisphere.intensity,
    windows: windows.map((pane) => [pane.material.emissiveIntensity, pane.children.find((child) => child.isPointLight).intensity]),
    lantern: lantern.intensity, shadow: [shadow.position.x, shadow.position.z, shadow.material.opacity],
  });
  for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
    cycle.setDayNightPhase(phase);
    const night = cycle.getNightAmount();
    weather.setWeather('clear'); weather.update(1.75, night);
    const clear = sample();
    weather.setWeather('cloudy'); weather.update(1.75, night);
    const cloudy = sample();
    weather.setWeather('snow'); weather.update(0.875, night);
    near(weather.getSnowAmount(), 0.5);
    near(weather.getWeather().cloudyAmount, 0.5);
    near(directional.intensity, cloudy.directional);
    weather.update(0.875, night);
    const snow = sample();
    near(snow.directional, clear.directional * 0.72);
    near(snow.directional, cloudy.directional);
    near(snow.ambientIntensity, cloudy.ambientIntensity);
    near(snow.hemisphereIntensity, cloudy.hemisphereIntensity);
    for (const key of ['ambient', 'sky', 'ground']) {
      near(snow[key][0], cloudy[key][0]);
      near(snow[key][1], cloudy[key][1]);
      near(snow[key][2], cloudy[key][2] * 1.03);
    }
    assert.deepEqual(snow.windows, clear.windows, phase);
    near(snow.lantern, clear.lantern);
    snow.shadow.forEach((value, index) => near(value, cloudy.shadow[index]));
    const flakes = scene.getObjectByName('snow-flakes');
    near(flakes.material.opacity, 0.8 * (phase === 'night' ? 0.7 : 1));
    assert.equal(scene.getObjectByName('rain-streaks').visible, false);
    for (let index = 1; index <= 6; index++) assert.equal(scene.getObjectByName(`rain-splash-${index}`).visible, false);
    weather.setWeather('clear'); weather.update(1.75, night);
    assert.deepEqual(sample(), clear);
    assert.equal(flakes.visible, false);
  }
  weather.dispose();
  assert.equal(scene.getObjectByName('weather-snow'), undefined);
});

test('snow crossfades and reverses with rain without changing the seeded rain stream', (t) => {
  function makeWeather(seed = 123) {
    const scene = new THREE.Scene();
    const anchor = new THREE.Group(); scene.add(anchor);
    const { camera } = createIsometricCamera();
    const seeded = createVisualRandom(seed);
    let calls = 0;
    const weather = createWeatherSystem({ scene, camera, anchor, groundHeight: 0, groundSize: 16, splashExclusions: [],
      random: () => { calls++; return seeded(); }, setDirectionalIntensityMultiplier() {}, setAmbientHemisphereColorMultiplier() {} });
    t.after(weather.dispose);
    return { scene, weather, calls: () => calls };
  }
  const snowy = makeWeather();
  const reference = makeWeather();
  const repeat = makeWeather();
  const different = makeWeather(124);
  assert.equal(snowy.calls(), reference.calls());
  snowy.weather.setWeather('snow');
  snowy.weather.update(1.75);
  for (const farm of [repeat, different]) {
    farm.weather.setWeather('snow');
    farm.weather.update(1.75);
  }
  const matrices = (farm) => farm.scene.getObjectByName('snow-flakes').instanceMatrix.array;
  assert.deepEqual(matrices(snowy), matrices(repeat));
  assert.notDeepEqual(matrices(snowy), matrices(different));
  reference.weather.update(1.75);
  assert.equal(snowy.calls(), reference.calls(), 'snow initialization must not consume rain RNG');
  snowy.weather.setWeather('rain');
  reference.weather.setWeather('rain');
  let sawSplash = false;
  for (let frame = 0; frame < 240; frame++) {
    snowy.weather.update(0.05);
    reference.weather.update(0.05);
    assert.deepEqual(snowy.weather.getWeather(), reference.weather.getWeather());
    assert.equal(snowy.calls(), reference.calls());
    assert.deepEqual(snowy.scene.getObjectByName('rain-streaks').geometry.attributes.position.array,
      reference.scene.getObjectByName('rain-streaks').geometry.attributes.position.array);
    const splashState = (scene) => Array.from({ length: 6 }, (_, index) => {
      const ring = scene.getObjectByName(`rain-splash-${index + 1}`);
      if (ring.visible) sawSplash = true;
      return [ring.visible, ...ring.position.toArray(), ring.scale.x, ring.material.opacity];
    });
    assert.deepEqual(splashState(snowy.scene), splashState(reference.scene));
  }
  assert.ok(sawSplash, 'the independent rain stream must be exercised through real splashes');
  assert.equal(snowy.weather.getSnowAmount(), 0);
  assert.equal(snowy.scene.getObjectByName('snow-flakes').visible, false);

  snowy.weather.setWeather('snow'); snowy.weather.update(0.875);
  near(snowy.weather.getWeather().rainAmount, 0.5);
  near(snowy.weather.getSnowAmount(), 0.5);
  snowy.weather.setWeather('rain'); snowy.weather.update(0);
  near(snowy.weather.getWeather().rainAmount, 0.5);
  near(snowy.weather.getSnowAmount(), 0.5);
  snowy.weather.update(0.875);
  near(snowy.weather.getWeather().rainAmount, 1);
  near(snowy.weather.getSnowAmount(), 0);
});
