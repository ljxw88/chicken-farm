import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { FARM_PALETTE } = await vite.ssrLoadModule('/src/scene/farmPalette.ts');
after(() => vite.close());

test('the visible dirt route connects spawn, barn and pond', () => {
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const path = scene.getObjectByName('farm-path');
  const ray = new THREE.Raycaster();
  for (const [x, z] of [
    [0, 0], [-0.7, -0.55], [-0.85, -1.05], [-1.6, -1.1], [-3.3, -1.28],
    [-0.85, -1.45], [-0.3, -2.2], [0.9, -2.55], [2.1, -2.4],
  ]) {
    ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    const [hit] = ray.intersectObject(path, true);
    assert.ok(hit, `no path visible at ${x}, ${z}`);
    assert.equal(hit.object.material.color.getHex(), 0xc4a06a);
  }
});

test('the farm has a barn, four solid trees and a pond with its water inside the blocker', () => {
  const scene = new THREE.Scene();
  const { windows, obstacles } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  assert.ok(scene.getObjectByName('farm-barn'));
  assert.equal(windows.length, 2);
  for (let i = 1; i <= 4; i++) {
    assert.ok(scene.getObjectByName(`farm-tree-${i}`));
    assert.ok(obstacles.find((obstacle) => obstacle.name === `tree-${i}`));
  }

  const water = scene.getObjectByName('farm-pond-water');
  const pond = obstacles.find((obstacle) => obstacle.name === 'pond');
  assert.equal(water.material.color.getHex(), 0x5a9ab8);
  for (let i = 0; i < water.geometry.attributes.position.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(water.geometry.attributes.position, i);
    water.localToWorld(vertex);
    assert.ok(Math.hypot(vertex.x - pond.x, vertex.z - pond.z) <= pond.radius);
  }
  assert.equal(FARM_PALETTE.grass, 0x7cb070);
});
