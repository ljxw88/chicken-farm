import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createChimneySmoke } = await vite.ssrLoadModule('/src/effects/createChimneySmoke.ts');
const { createVisualRandom } = await vite.ssrLoadModule('/src/effects/createVisualRandom.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { parseVisualSeed } = await vite.ssrLoadModule('/src/startupOptions.ts');
after(() => vite.close());

function fixture(t, random) {
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  const smoke = createChimneySmoke({ scene, random });
  t.after(smoke.dispose);
  const root = scene.getObjectByName('chimney-smoke');
  return { scene, smoke, root, puffs: root.children };
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('the visual seed is optional, bounded and repeatable without changing the default weather', () => {
  assert.equal(parseVisualSeed(''), undefined);
  assert.equal(parseVisualSeed('?seed=0'), 0);
  assert.equal(parseVisualSeed('?seed=3950182401'), 3950182401);
  assert.equal(parseVisualSeed('?seed=0xeb730001'), 0xeb730001);
  for (const value of ['', '-1', '1.5', 'Infinity', '4294967296', 'garbage']) {
    assert.equal(parseVisualSeed(`?seed=${value}`), undefined, value);
  }
  const a = createVisualRandom(0xeb730001);
  const b = createVisualRandom(0xeb730001);
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

test('six flat, non-emissive puffs use the actual chimney anchor and specified motion', (t) => {
  // This draw selects the nominal size and a zero sway phase.
  const { scene, smoke, puffs } = fixture(t, () => 0.625);
  const anchor = scene.getObjectByName('cottage-chimney-top').getWorldPosition(new THREE.Vector3());
  near(anchor.y, 6);
  assert.equal(puffs.length, 6);
  assert.ok(puffs.every((puff) => puff.visible && puff.geometry.type === 'IcosahedronGeometry'));
  assert.ok(puffs.every((puff) => puff.geometry.parameters.detail === 0 && puff.material.isMeshStandardMaterial &&
    puff.material.flatShading && puff.material.emissive.getHex() === 0 && puff.material.color.getHex() === 0xefe3c8));
  const born = puffs[0];
  near(born.position.distanceTo(anchor), 0);
  near(born.scale.x, 0.28);
  near(born.material.opacity, 0.75);
  const vertices = born.geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = new THREE.Vector3().fromBufferAttribute(vertices, i + edge);
      const b = new THREE.Vector3().fromBufferAttribute(vertices, i + (edge + 1) % 3);
      assert.ok(a.distanceTo(b) * born.scale.x >= 0.1, 'a birth-sized puff has a sub-0.1 edge');
    }
  }
  smoke.update(1, 0, 0);
  near(born.position.y, anchor.y + 0.45);
  const wind = new THREE.Vector3(0.94, 0, -0.34).normalize().multiplyScalar(0.25);
  near(born.position.x, anchor.x + wind.x + 0.06);
  near(born.position.z, anchor.z + wind.z);
  near(born.scale.x, 0.28 + (0.65 - 0.28) * (1 / 3.6) ** 1.5);
  near(born.material.opacity, 0.75);
  const size = new THREE.Box3().setFromObject(born).getSize(new THREE.Vector3());
  for (const axis of ['x', 'y', 'z']) near(size[axis], born.scale.x);
});

test('puffs hold, ease out and live 3.6 seconds without exceeding six slots', (t) => {
  const { smoke, puffs } = fixture(t, () => 0.625);
  const born = puffs[0];
  smoke.update(1.44, 0, 0); // 40% of life.
  assert.equal(born.visible, true);
  near(born.material.opacity, 0.75);
  smoke.update(0.0001, 0, 0);
  assert.ok(born.material.opacity < 0.75 && born.material.opacity > 0.7499999);
  smoke.update(1.0799, 0, 0); // 70% of life: halfway through the easing interval.
  near(born.material.opacity, 0.375);
  smoke.update(1.07, 0, 0);
  assert.equal(born.visible, true);
  assert.ok(born.scale.x < 0.65 && born.scale.x > 0.64);
  assert.ok(born.material.opacity > 0 && born.material.opacity < 0.01);
  smoke.update(0.01, 0, 0);
  assert.equal(born.visible, false);
  for (let frame = 0; frame < 1200; frame++) {
    smoke.update(1 / 60, 0, 0);
    const active = puffs.filter((puff) => puff.visible);
    assert.ok(active.length >= 5 && active.length <= 6);
    for (const puff of active) {
      assert.ok(puff.scale.x >= 0.28 && puff.scale.x < 0.65);
      assert.ok(puff.material.opacity >= 0 && puff.material.opacity <= 0.75);
    }
  }
});

test('births follow 0.55-second ticks, except when all six puffs are still alive', (t) => {
  const { smoke, puffs } = fixture(t, () => 0.625);
  smoke.update(0.55, 0, 0);
  assert.equal(puffs.filter((puff) => puff.visible && Math.abs(puff.scale.x - 0.28) < 1e-8).length, 0);
  for (let tick = 2; tick <= 7; tick++) {
    smoke.update(0.55, 0, 0);
    assert.equal(puffs.filter((puff) => puff.visible && Math.abs(puff.scale.x - 0.28) < 1e-8).length, 1, `tick ${tick}`);
  }
  smoke.update(0.55, 0, 0);
  assert.equal(puffs.filter((puff) => puff.visible && Math.abs(puff.scale.x - 0.28) < 1e-8).length, 0);
});

test('rain and night each reduce opacity to 60% without double-dimming, and rain shortens life to 2.6 seconds', (t) => {
  const clear = fixture(t, () => 0.625);
  const rain = fixture(t, () => 0.625);
  const night = fixture(t, () => 0.625);
  const rainyNight = fixture(t, () => 0.625);
  clear.smoke.update(0, 0, 0);
  rain.smoke.update(0, 1, 0);
  night.smoke.update(0, 0, 1);
  rainyNight.smoke.update(0, 1, 1);
  near(rain.puffs[0].material.opacity, clear.puffs[0].material.opacity * 0.6);
  near(night.puffs[0].material.opacity, clear.puffs[0].material.opacity * 0.6);
  near(rainyNight.puffs[0].material.opacity, clear.puffs[0].material.opacity * 0.6);
  rainyNight.smoke.update(0, 0.5, 0.5);
  near(rainyNight.puffs[0].material.opacity, clear.puffs[0].material.opacity * 0.8);
  rain.smoke.update(2.59, 1, 0);
  assert.equal(rain.puffs[0].visible, true);
  assert.ok(rain.puffs[0].scale.x > 0.64 && rain.puffs[0].scale.x < 0.65);
  rain.smoke.update(0.01, 1, 0);
  assert.equal(rain.puffs[0].visible, false);
  for (let frame = 0; frame < 600; frame++) {
    rain.smoke.update(1 / 60, 1, 0);
    const active = rain.puffs.filter((puff) => puff.visible);
    assert.ok(active.length >= 4 && active.length <= 5);
    assert.ok(active.every((puff) => puff.scale.x >= 0.28 && puff.scale.x < 0.65 && puff.material.opacity <= 0.45 + 1e-12));
  }
});

test('seeded puff sizes vary by at most 15% and sway stays within 0.06 of the wind path', (t) => {
  const seed = 3950182401 ^ 0x534d4f4b;
  const minimum = fixture(t, () => 0);
  const maximum = fixture(t, () => 0x3fffffff / 0x100000000);
  near(minimum.puffs[0].scale.x, 0.28 * 0.85);
  assert.ok(maximum.puffs[0].scale.x > 0.28 * 1.1499);
  const { scene, smoke, puffs } = fixture(t, createVisualRandom(seed));
  const originalStream = createVisualRandom(seed);
  const originalOrientations = puffs.map(() => Math.floor(originalStream() * 4) * Math.PI / 2);
  assert.deepEqual(puffs.map((puff) => puff.rotation.y), originalOrientations);
  const anchor = scene.getObjectByName('cottage-chimney-top').getWorldPosition(new THREE.Vector3());
  const wind = new THREE.Vector3(0.94, 0, -0.34).normalize().multiplyScalar(0.25);
  const baseSize = (age) => 0.28 + 0.37 * (age / 3.6) ** 1.5;
  const initialSizes = puffs.map((puff, index) => puff.scale.x / baseSize(index * 0.55));
  const offsets = puffs.map((puff, index) => puff.position.x - anchor.x - wind.x * index * 0.55);
  assert.ok(initialSizes.every((size) => size >= 0.85 && size <= 1.15));
  assert.ok(offsets.every((offset) => Math.abs(offset) <= 0.06 + 1e-12));
  assert.ok(new Set(initialSizes).size > 1, 'puffs must have individual sizes');
  assert.ok(new Set(offsets.map((offset) => offset.toFixed(6))).size > 1, 'puffs must have individual sway phases');
  smoke.update(1.1, 0, 0); // The oldest slot is reborn at this tick.
  const rebornSize = puffs[5].scale.x / 0.28;
  assert.ok(rebornSize >= 0.85 && rebornSize <= 1.15);
  assert.notEqual(rebornSize, initialSizes[5]);
  for (let step = 0; step < 200; step++) {
    smoke.update(0.025, 0, 0);
    for (const puff of puffs.filter((item) => item.visible)) {
      const age = (puff.position.y - anchor.y) / 0.45;
      const size = puff.scale.x / baseSize(age);
      assert.ok(size >= 0.85 - 1e-12 && size <= 1.15 + 1e-12);
      assert.ok(Math.abs(puff.position.x - anchor.x - wind.x * age) <= 0.06 + 1e-12);
      near(puff.position.z, anchor.z + wind.z * age);
    }
  }
});

test('smoke is reproducible with injected seeds and does not create lights or survive disposal', (t) => {
  const a = fixture(t, createVisualRandom(123));
  const b = fixture(t, createVisualRandom(123));
  for (const delta of [0, 0.1, 1, 0.4, 3.2, 1.1]) {
    a.smoke.update(delta, 0.4, 0.7);
    b.smoke.update(delta, 0.4, 0.7);
    const describe = (puff) => [puff.visible, puff.rotation.y, ...puff.position.toArray(), puff.scale.x, puff.material.opacity];
    assert.deepEqual(a.puffs.map(describe), b.puffs.map(describe));
  }
  let lights = 0;
  a.root.traverse((object) => { if (object.isLight) lights++; });
  assert.equal(lights, 0);
  assert.throws(() => a.smoke.update(-1, 0, 0), RangeError);
  assert.throws(() => a.smoke.update(0, 2, 0), RangeError);
  assert.throws(() => a.smoke.update(0, 0, 2), RangeError);
  a.smoke.dispose();
  assert.equal(a.scene.getObjectByName('chimney-smoke'), undefined);
});

test('the plume rises above the cottage roof and does not enter the roof or windows', (t) => {
  const { scene, smoke, puffs } = fixture(t);
  const roof = new THREE.Box3().setFromObject(scene.getObjectByName('cottage-roof'));
  const windows = ['cottage-window-1', 'cottage-window-2', 'cottage-east-window']
    .map((name) => new THREE.Box3().setFromObject(scene.getObjectByName(name)));
  for (let frame = 0; frame < 240; frame++) {
    smoke.update(1 / 60, 0, 0);
    for (const puff of puffs.filter((item) => item.visible)) {
      const bounds = new THREE.Box3().setFromObject(puff);
      assert.ok(bounds.min.y > roof.max.y, 'smoke entered the roof ridge');
      assert.ok(windows.every((window) => !bounds.intersectsBox(window)), 'smoke entered a window');
    }
  }
});
