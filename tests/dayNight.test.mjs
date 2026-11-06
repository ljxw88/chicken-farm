import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { configureDayNightFromUrl } = await vite.ssrLoadModule('/src/lighting/configureDayNightFromUrl.ts');
const { VOID_COLOR } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

function fixture() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID_COLOR);
  const character = createCharacter();
  scene.add(character);
  const { windows } = createFarmLayout(scene);
  const cycle = createDayNightCycle({ scene, character, windows });
  return {
    scene, character, windows, cycle,
    ambient: scene.getObjectByName('day-night-ambient'),
    hemisphere: scene.getObjectByName('day-night-hemisphere'),
    directional: scene.getObjectByName('day-night-directional'),
    lantern: character.getObjectByName('lantern'),
    lanternGlass: character.getObjectByName('lantern-glass'),
    lanternLight: character.getObjectByName('lantern-light'),
    windowLights: windows.map((pane) => pane.children.find((child) => child.isPointLight)),
  };
}

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function colorNear(actual, expected, tolerance = 1e-9) {
  near(actual.r, expected.r, tolerance);
  near(actual.g, expected.g, tolerance);
  near(actual.b, expected.b, tolerance);
}

test('all four phases keep the void and use the locked fog and light presets', () => {
  const { scene, cycle, ambient, hemisphere, directional, windows, windowLights, lanternGlass, lanternLight } = fixture();
  const expected = {
    morning: [0xe8d4c8, 0xe8d4c8, 0.012, 0xf0e0d0, 0.25, 0xe8d4c8, 0xa8c090, 0.55, 0xffe8c8, 0.55],
    daytime: [0xa8d4f0, 0xc8e0f0, 0.006, 0xe8f0e8, 0.15, 0xa8d4f0, 0x9cb88a, 0.85, 0xfff2d6, 1.1],
    sunset: [0xf0a878, 0xe89870, 0.015, 0xe89870, 0.28, 0xf0a878, 0xc89070, 0.45, 0xff8a50, 0.65],
    night: [0x2a2848, 0x1e2430, 0.02, 0x3a4560, 0.18, 0x2a2848, 0x1e2430, 0.22, 0xc8d4f0, 0.22],
  };

  assert.equal(scene.fog.isFogExp2, true);
  assert.equal(windows.length, 2);
  assert.ok(windows.every((window) => window.parent.name === 'farm-barn'));
  for (const [phase, values] of Object.entries(expected)) {
    cycle.setDayNightPhase(phase);
    assert.equal(scene.background.getHex(), 0x101416, phase);
    assert.equal(scene.fog.color.getHex(), values[1], phase);
    near(scene.fog.density, values[2]);
    assert.equal(ambient.color.getHex(), values[3], phase);
    near(ambient.intensity, values[4]);
    assert.equal(hemisphere.color.getHex(), values[5], phase);
    assert.equal(hemisphere.groundColor.getHex(), values[6], phase);
    near(hemisphere.intensity, values[7]);
    assert.equal(directional.color.getHex(), values[8], phase);
    near(directional.intensity, values[9]);
    for (const [index, light] of windowLights.entries()) {
      assert.equal(light.color.getHex(), 0xffcc88);
      near(light.intensity, phase === 'night' ? 0.85 : 0);
      near(light.distance, 7);
      near(light.decay, 2);
      assert.equal(windows[index].material.emissive.getHex(), 0xffcc88);
      near(windows[index].material.emissiveIntensity, phase === 'night' ? 0.85 : 0);
    }
    assert.equal(lanternLight.color.getHex(), 0xffb060);
    near(lanternLight.intensity, phase === 'night' ? 0.55 : 0);
    near(lanternLight.distance, 3.5);
    near(lanternLight.decay, 2);
    assert.equal(lanternGlass.material.emissive.getHex(), 0xffb060);
    near(lanternGlass.material.emissiveIntensity, phase === 'night' ? 0.55 : 0);
  }
});

test('the default 72-second cycle advances through all four phases and wraps', () => {
  const { scene, cycle, hemisphere } = fixture();
  assert.equal(hemisphere.color.getHex(), 0xe8d4c8);
  for (const sky of [0xa8d4f0, 0xf0a878, 0x2a2848, 0xe8d4c8]) {
    cycle.update(18);
    assert.equal(hemisphere.color.getHex(), sky);
    assert.equal(scene.background.getHex(), 0x101416);
  }
  cycle.update(72 * 3 + 18);
  assert.equal(hemisphere.color.getHex(), 0xa8d4f0);
});

test('the current phase can be read as the existing lighting cycle advances or is set', () => {
  const { cycle } = fixture();
  assert.equal(cycle.getPhase(), 'morning');
  cycle.update(18);
  assert.equal(cycle.getPhase(), 'daytime');
  cycle.update(18);
  assert.equal(cycle.getPhase(), 'sunset');
  cycle.setDayNightPhase('night');
  assert.equal(cycle.getPhase(), 'night');
  cycle.update(18);
  assert.equal(cycle.getPhase(), 'morning');
});

test('colors, intensities, fog and practical lights blend smoothly between presets', () => {
  const { scene, cycle, ambient, hemisphere, directional, windowLights, lanternLight } = fixture();
  cycle.update(4.5); // A quarter of the morning-to-day interval, smoothstep = 0.15625.
  const blend = 0.15625;
  assert.equal(scene.background.getHex(), 0x101416);
  colorNear(hemisphere.color, new THREE.Color(0xe8d4c8).lerp(new THREE.Color(0xa8d4f0), blend));
  colorNear(scene.fog.color, new THREE.Color(0xe8d4c8).lerp(new THREE.Color(0xc8e0f0), blend));
  colorNear(ambient.color, new THREE.Color(0xf0e0d0).lerp(new THREE.Color(0xe8f0e8), blend));
  colorNear(hemisphere.groundColor, new THREE.Color(0xa8c090).lerp(new THREE.Color(0x9cb88a), blend));
  colorNear(directional.color, new THREE.Color(0xffe8c8).lerp(new THREE.Color(0xfff2d6), blend));
  near(scene.fog.density, 0.012 + (0.006 - 0.012) * blend);
  near(ambient.intensity, 0.25 + (0.15 - 0.25) * blend);
  near(hemisphere.intensity, 0.55 + (0.85 - 0.55) * blend);
  near(directional.intensity, 0.55 + (1.1 - 0.55) * blend);

  cycle.setDayNightPhase('sunset');
  cycle.update(9);
  near(windowLights[0].intensity, 0.85 / 2);
  near(windowLights[1].intensity, 0.85 / 2);
  near(lanternLight.intensity, 0.55 / 2);
  cycle.update(9);
  near(lanternLight.intensity, 0.55);
  cycle.update(9);
  near(lanternLight.intensity, 0.55 / 2);
  cycle.update(9);
  near(lanternLight.intensity, 0);
});

test('the night-to-morning wrap has no lighting or directional-position jump', () => {
  const { scene, cycle, directional, hemisphere, lanternLight } = fixture();
  const morningSky = hemisphere.color.clone();
  const morningDirection = directional.position.clone();
  cycle.setDayNightPhase('night');
  cycle.update(18 - 0.001);
  colorNear(hemisphere.color, morningSky, 1e-8);
  assert.equal(scene.background.getHex(), 0x101416);
  assert.ok(directional.position.distanceTo(morningDirection) < 0.005);
  assert.ok(lanternLight.intensity < 0.000001);
  cycle.update(0.002);
  assert.ok(directional.position.distanceTo(morningDirection) < 0.005);
  colorNear(hemisphere.color, morningSky, 1e-8);
  assert.equal(scene.background.getHex(), 0x101416);
});

test('the sun and moon arc above the ground with a low sunset', () => {
  const { cycle, directional } = fixture();
  cycle.setDayNightPhase('daytime');
  const daytimeElevation = Math.atan2(directional.position.y, Math.hypot(directional.position.x, directional.position.z));
  cycle.setDayNightPhase('sunset');
  const sunsetElevation = Math.atan2(directional.position.y, Math.hypot(directional.position.x, directional.position.z));
  assert.ok(sunsetElevation < Math.PI / 12);
  assert.ok(daytimeElevation > sunsetElevation);
  cycle.setDayNightPhase('night');
  assert.ok(directional.position.y > 0);
  for (let i = 0; i < 64; i++) {
    cycle.update(72 / 64);
    assert.ok(directional.position.y > 0);
  }
});

test('the lantern stays attached to the moving and turning character', () => {
  const { scene, character, lantern, lanternLight } = fixture();
  assert.equal(lantern.parent, character);
  assert.equal(lanternLight.parent, lantern);
  scene.updateMatrixWorld(true);
  const before = lanternLight.getWorldPosition(new THREE.Vector3());
  character.position.set(4, 0, -2);
  character.rotation.y = Math.PI / 2;
  scene.updateMatrixWorld(true);
  const after = lanternLight.getWorldPosition(new THREE.Vector3());
  const expected = character.localToWorld(lantern.position.clone());
  assert.ok(before.distanceTo(after) > 1);
  near(after.distanceTo(expected), 0);
});

test('changing cycle speed preserves progress and rejects invalid inputs', () => {
  const { cycle, hemisphere } = fixture();
  cycle.update(9);
  const before = hemisphere.color.clone();
  cycle.setDayNightCycleSeconds(144);
  colorNear(hemisphere.color, before);
  cycle.update(18);
  assert.equal(hemisphere.color.getHex(), 0xa8d4f0);
  for (const invalid of [0, -1, Infinity, NaN, '12']) {
    assert.throws(() => cycle.setDayNightCycleSeconds(invalid), RangeError);
  }
  assert.throws(() => cycle.setDayNightPhase('midnight'), RangeError);
  assert.throws(() => cycle.update(-1), RangeError);
  assert.throws(() => cycle.update(Infinity), RangeError);
  cycle.update(36);
  assert.equal(hemisphere.color.getHex(), 0xf0a878);
});

test('a valid phase URL selects and holds each phase without changing the void', () => {
  const expected = {
    morning: [0xe8d4c8, 0xffe8c8, 0],
    daytime: [0xa8d4f0, 0xfff2d6, 0],
    sunset: [0xf0a878, 0xff8a50, 0],
    night: [0x2a2848, 0xc8d4f0, 0.55],
  };
  for (const [phase, [sky, sun, lanternIntensity]] of Object.entries(expected)) {
    const { scene, cycle, hemisphere, directional, lanternLight } = fixture();
    const update = configureDayNightFromUrl(`?other=kept&phase=${phase}`, cycle);
    assert.equal(hemisphere.color.getHex(), sky, phase);
    assert.equal(directional.color.getHex(), sun, phase);
    near(lanternLight.intensity, lanternIntensity);
    cycle.setDayNightCycleSeconds(1);
    update(125);
    assert.equal(hemisphere.color.getHex(), sky, phase);
    assert.equal(directional.color.getHex(), sun, phase);
    assert.equal(scene.background.getHex(), 0x101416, phase);
    near(lanternLight.intensity, lanternIntensity);
  }
});

test('missing or invalid phase URLs retain the normal running cycle', () => {
  for (const search of ['', '?weather=clear', '?phase=', '?phase=midnight', '?phase=SUNSET']) {
    const { cycle, hemisphere } = fixture();
    const update = configureDayNightFromUrl(search, cycle);
    assert.equal(hemisphere.color.getHex(), 0xe8d4c8, search);
    update(18);
    assert.equal(hemisphere.color.getHex(), 0xa8d4f0, search);
  }
});
