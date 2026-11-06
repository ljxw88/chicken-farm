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

test('five flat, non-emissive puffs use the actual chimney anchor and specified motion', (t) => {
  const { scene, smoke, puffs } = fixture(t, () => 0);
  const anchor = scene.getObjectByName('cottage-chimney-top').getWorldPosition(new THREE.Vector3());
  near(anchor.y, 6);
  assert.equal(puffs.length, 5);
  assert.ok(puffs.every((puff) => puff.visible && puff.geometry.type === 'IcosahedronGeometry'));
  assert.ok(puffs.every((puff) => puff.geometry.parameters.detail === 0 && puff.material.isMeshStandardMaterial &&
    puff.material.flatShading && puff.material.emissive.getHex() === 0 && puff.material.color.getHex() === 0xe4d1ae));
  const born = puffs[0];
  near(born.position.distanceTo(anchor), 0);
  near(born.scale.x, 0.22);
  near(born.material.opacity, 0.55);
  const vertices = born.geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = new THREE.Vector3().fromBufferAttribute(vertices, i + edge);
      const b = new THREE.Vector3().fromBufferAttribute(vertices, i + (edge + 1) % 3);
      assert.ok(a.distanceTo(b) * born.scale.x >= 0.1, 'a birth-sized puff has a sub-0.1 edge');
    }
  }
  smoke.update(1, 0);
  near(born.position.y, anchor.y + 0.5);
  const wind = new THREE.Vector3(0.94, 0, -0.34).normalize().multiplyScalar(0.25);
  near(born.position.x, anchor.x + wind.x);
  near(born.position.z, anchor.z + wind.z);
  near(born.scale.x, 0.22 + (0.5 - 0.22) / 3.2);
  near(born.material.opacity, 0.55 * (1 - 1 / 3.2));
  const size = new THREE.Box3().setFromObject(born).getSize(new THREE.Vector3());
  for (const axis of ['x', 'y', 'z']) near(size[axis], born.scale.x);
});

test('puffs stay in bounds, live 3.2 seconds and the five-slot pool never truncates them', (t) => {
  const { smoke, puffs } = fixture(t, () => 0.5);
  const born = puffs[0];
  smoke.update(3.19, 0);
  assert.equal(born.visible, true);
  assert.ok(born.scale.x < 0.5 && born.scale.x > 0.49);
  smoke.update(0.01, 0);
  assert.equal(born.visible, false);
  for (let frame = 0; frame < 1200; frame++) {
    smoke.update(1 / 60, 0);
    const active = puffs.filter((puff) => puff.visible);
    assert.ok(active.length >= 4 && active.length <= 5);
    for (const puff of active) {
      assert.ok(puff.scale.x >= 0.22 && puff.scale.x < 0.5);
      assert.ok(puff.material.opacity > 0 && puff.material.opacity <= 0.55);
    }
  }
});

test('births follow 0.6-second ticks, except when all five puffs are still alive', (t) => {
  const { smoke, puffs } = fixture(t, () => 0);
  smoke.update(0.6, 0);
  assert.equal(puffs.filter((puff) => puff.visible && Math.abs(puff.scale.x - 0.22) < 1e-8).length, 0);
  for (let tick = 2; tick <= 5; tick++) {
    smoke.update(0.6, 0);
    assert.equal(puffs.filter((puff) => puff.visible && Math.abs(puff.scale.x - 0.22) < 1e-8).length, 1, `tick ${tick}`);
  }
  smoke.update(0.6, 0);
  assert.equal(puffs.filter((puff) => puff.visible && Math.abs(puff.scale.x - 0.22) < 1e-8).length, 1);
});

test('rain reduces opacity to 60% and lifetime to 2.2 seconds', (t) => {
  const clear = fixture(t, () => 0);
  const rain = fixture(t, () => 0);
  clear.smoke.update(0, 0);
  rain.smoke.update(0, 1);
  near(rain.puffs[0].material.opacity, clear.puffs[0].material.opacity * 0.6);
  rain.smoke.update(2.19, 1);
  assert.equal(rain.puffs[0].visible, true);
  assert.ok(rain.puffs[0].scale.x > 0.49 && rain.puffs[0].scale.x < 0.5);
  rain.smoke.update(0.01, 1);
  assert.equal(rain.puffs[0].visible, false);
  for (let frame = 0; frame < 600; frame++) {
    rain.smoke.update(1 / 60, 1);
    const active = rain.puffs.filter((puff) => puff.visible);
    assert.ok(active.length >= 3 && active.length <= 4);
    assert.ok(active.every((puff) => puff.scale.x >= 0.22 && puff.scale.x < 0.5 && puff.material.opacity <= 0.33));
  }
});

test('smoke is reproducible with injected seeds and does not create lights or survive disposal', (t) => {
  const a = fixture(t, createVisualRandom(123));
  const b = fixture(t, createVisualRandom(123));
  for (const delta of [0, 0.1, 1, 0.4, 3.2, 1.1]) {
    a.smoke.update(delta, 0.4);
    b.smoke.update(delta, 0.4);
    const describe = (puff) => [puff.visible, puff.rotation.y, ...puff.position.toArray(), puff.scale.x, puff.material.opacity];
    assert.deepEqual(a.puffs.map(describe), b.puffs.map(describe));
  }
  let lights = 0;
  a.root.traverse((object) => { if (object.isLight) lights++; });
  assert.equal(lights, 0);
  assert.throws(() => a.smoke.update(-1, 0), RangeError);
  assert.throws(() => a.smoke.update(0, 2), RangeError);
  a.smoke.dispose();
  assert.equal(a.scene.getObjectByName('chimney-smoke'), undefined);
});

test('the plume rises above the cottage roof and does not enter the roof or windows', (t) => {
  const { scene, smoke, puffs } = fixture(t);
  const roof = new THREE.Box3().setFromObject(scene.getObjectByName('cottage-roof'));
  const windows = ['cottage-window-1', 'cottage-window-2', 'cottage-east-window']
    .map((name) => new THREE.Box3().setFromObject(scene.getObjectByName(name)));
  for (let frame = 0; frame < 240; frame++) {
    smoke.update(1 / 60, 0);
    for (const puff of puffs.filter((item) => item.visible)) {
      const bounds = new THREE.Box3().setFromObject(puff);
      assert.ok(bounds.min.y > roof.max.y, 'smoke entered the roof ridge');
      assert.ok(windows.every((window) => !bounds.intersectsBox(window)), 'smoke entered a window');
    }
  }
});
