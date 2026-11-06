import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { FARM_PALETTE } = await vite.ssrLoadModule('/src/scene/farmPalette.ts');
const { BUILDING_PALETTE } = await vite.ssrLoadModule('/src/scene/farmBuildingMaterials.ts');
const { GROUND_HEIGHT, GROUND_SIZE } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

test('the original farm palette stays locked alongside the building palette', () => {
  assert.deepEqual(FARM_PALETTE, {
    grass: 0x5fa846, dirt: 0xa67c52, dirtEdge: 0x7a5a3a, dirtHighlight: 0xc4a06a,
    barnWood: 0xd4a574, barnTrim: 0x8b6914, barnRoof: 0xc45a3a, barnDoor: 0x6b4423, barnWindow: 0x8aa0a8,
    treeTrunk: 0x6b4a2e, treeFoliageDark: 0x3d7a3a, treeFoliage: 0x5fa846, treeFoliageLight: 0x7cbc5a, wool: 0xf3ead6,
    pondWater: 0x5b8fa8, pondRim: 0x7aadb8, pondDepth: 0x3a6a7a,
  });
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  const allowed = new Set([...Object.values(FARM_PALETTE), ...Object.values(BUILDING_PALETTE)]);
  scene.traverse((object) => {
    if (!object.isMesh) return;
    if (object.name.startsWith('farm-tree-shadow-')) {
      // The unlit contact is a darkened version of main's green tree blob.
      assert.equal(object.material.isMeshBasicMaterial, true);
      assert.equal(object.material.color.getHex(), 0x0a1409);
      assert.equal(object.material.transparent, true);
      return;
    }
    // The separately locked water feature has its own palette; keep checking
    // every pre-existing farm mesh rather than expanding that palette.
    let ancestor = object.parent;
    while (ancestor && ancestor.name !== 'farm-water-feature') ancestor = ancestor.parent;
    if (!ancestor) assert.ok(allowed.has(object.material.color.getHex()), `unexpected color on ${object.name}`);
  });
});

test('the raised dirt route connects the cottage, spawn, pond and island edge', () => {
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const surface = scene.getObjectByName('farm-path-surface');
  const edge = scene.getObjectByName('farm-path-edge');
  const highlight = scene.getObjectByName('farm-path-highlight');
  assert.equal(surface.material.color.getHex(), 0xa67c52);
  assert.equal(edge.material.color.getHex(), 0x7a5a3a);
  assert.equal(highlight.material.color.getHex(), 0xc4a06a);
  const positions = surface.geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 2) {
    const width = Math.hypot(positions.getX(i) - positions.getX(i + 1), positions.getZ(i) - positions.getZ(i + 1));
    if (Math.max(positions.getX(i), positions.getX(i + 1)) < GROUND_SIZE / 2 - 0.001) {
      assert.ok(width >= 1.1 && width <= 1.3, `path width ${width}`);
    }
    assert.ok(Math.abs(positions.getX(i)) <= GROUND_SIZE / 2 && Math.abs(positions.getX(i + 1)) <= GROUND_SIZE / 2);
    assert.ok(Math.abs(positions.getZ(i)) <= GROUND_SIZE / 2 && Math.abs(positions.getZ(i + 1)) <= GROUND_SIZE / 2);
    assert.ok(positions.getY(i) >= GROUND_HEIGHT + 0.02 && positions.getY(i) <= GROUND_HEIGHT + 0.04);
  }
  const ray = new THREE.Raycaster();
  for (const [x, z] of [
    [-3.3, -1.28], [-1.6, -1.1], [-0.75, -0.65], [0, 0], [0.85, -0.2], [1.6, -0.9],
    [2.5, -1.7], [3.4, -1.93], [4.3, -1.95], [5.15, -1.65], [6, -0.9],
    [7.6, 0.4], [7.95, 0.7],
  ]) {
    ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    assert.ok(ray.intersectObject(surface).length, `no path visible at ${x}, ${z}`);
  }
});

test('the four stacked trees use the locked dimensions', () => {
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  for (let i = 1; i <= 4; i++) {
    const tree = scene.getObjectByName(`farm-tree-${i}`);
    assert.ok(tree);
    assert.ok(obstacles.find((obstacle) => obstacle.name === `tree-${i}`));
    const size = new THREE.Box3().setFromObject(tree).getSize(new THREE.Vector3());
    assert.ok(size.y >= 2.4 && size.y <= 3, `tree ${i} height ${size.y}`);
    assert.ok(size.x >= 1.6 && size.x <= 2.2, `tree ${i} width ${size.x}`);
    assert.ok(size.z >= 1.6 && size.z <= 2.2, `tree ${i} depth ${size.z}`);
  }
});

test('the oval pond uses the locked water materials and blocks its water', () => {
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const rim = scene.getObjectByName('farm-pond-rim');
  const water = scene.getObjectByName('farm-pond-water');
  const depth = scene.getObjectByName('farm-pond-depth');
  const pond = obstacles.find((obstacle) => obstacle.name === 'pond');
  const size = new THREE.Box3().setFromObject(rim).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - 3.5) < 0.3 && Math.abs(size.z - 2.2) < 0.25);
  assert.ok(Math.abs(rim.getWorldPosition(new THREE.Vector3()).y - (GROUND_HEIGHT + 0.027)) < 0.001);
  assert.equal(rim.material.color.getHex(), 0x7aadb8);
  assert.equal(water.material.color.getHex(), 0x5b8fa8);
  assert.equal(depth.material.color.getHex(), 0x3a6a7a);
  assert.equal(water.material.roughness, 0.25);
  assert.equal(pond.kind, 'box');
  for (let i = 0; i < water.geometry.attributes.position.count; i++) {
    const vertex = new THREE.Vector3().fromBufferAttribute(water.geometry.attributes.position, i);
    water.localToWorld(vertex);
    assert.ok(vertex.x >= pond.minX && vertex.x <= pond.maxX && vertex.z >= pond.minZ && vertex.z <= pond.maxZ);
  }
});
