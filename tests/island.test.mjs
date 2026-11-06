import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createIsland, GROUND_SIZE, GROUND_HEIGHT, ISLAND_BOTTOM, VOID_COLOR } =
  await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
after(() => vite.close());

test('the raised grass top is finite, raycastable and surrounded by the specified void family', () => {
  const scene = new THREE.Scene();
  const { ground } = createIsland(scene);
  scene.updateMatrixWorld(true);
  assert.ok(GROUND_HEIGHT > ISLAND_BOTTOM);
  const ray = new THREE.Raycaster();
  const half = GROUND_SIZE / 2;
  for (const [x, z, hit] of [
    [0, 0, true], [half - 0.01, 0, true], [-half + 0.01, 0, true],
    [0, half - 0.01, true], [0, -half + 0.01, true],
    [half + 0.01, 0, false], [-half - 0.01, 0, false],
    [0, half + 0.01, false], [0, -half - 0.01, false],
  ]) {
    ray.set(new THREE.Vector3(x, GROUND_HEIGHT + 5, z), new THREE.Vector3(0, -1, 0));
    const intersections = ray.intersectObject(ground);
    assert.equal(intersections.length > 0, hit, `${x}, ${z}`);
    if (hit) assert.ok(Math.abs(intersections[0].point.y - GROUND_HEIGHT) < 1e-6);
  }
  assert.equal(ground.material.color.getHex(), 0x5fa846);
  const channels = [(VOID_COLOR >> 16) & 255, (VOID_COLOR >> 8) & 255, VOID_COLOR & 255];
  assert.ok(channels.every((value, index) => value >= [0x0e, 0x12, 0x14][index] && value <= [0x14, 0x18, 0x1a][index]));
});

test('grass, soil and rock form a closed cross-section on all four rim faces', () => {
  const scene = new THREE.Scene();
  const { island } = createIsland(scene);
  scene.updateMatrixWorld(true);
  const half = GROUND_SIZE / 2;
  const ray = new THREE.Raycaster();
  const faces = [
    ['front', new THREE.Vector3(0, 0, half + 1), new THREE.Vector3(0, 0, -1)],
    ['back', new THREE.Vector3(0, 0, -half - 1), new THREE.Vector3(0, 0, 1)],
    ['right', new THREE.Vector3(half + 1, 0, 0), new THREE.Vector3(-1, 0, 0)],
    ['left', new THREE.Vector3(-half - 1, 0, 0), new THREE.Vector3(1, 0, 0)],
  ];
  for (const [layer, y] of [['grass-lip', GROUND_HEIGHT - 0.08], ['soil', GROUND_HEIGHT - 0.45], ['rock', ISLAND_BOTTOM + 0.5]]) {
    for (const [face, origin, direction] of faces) {
      const mesh = island.getObjectByName(`island-${layer}-${face}`);
      assert.ok(mesh, `${layer} ${face}`);
      ray.set(origin.clone().setY(y), direction);
      assert.ok(ray.intersectObject(mesh).length > 0, `gap in ${layer} ${face}`);
    }
  }
  const underside = island.getObjectByName('island-underside');
  ray.set(new THREE.Vector3(0, ISLAND_BOTTOM - 1, 0), new THREE.Vector3(0, 1, 0));
  assert.ok(ray.intersectObject(underside).length > 0);
});

test('the existing farm, path and props all remain over the island top', () => {
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const half = GROUND_SIZE / 2;
  for (const name of ['farm-layout', 'farm-barn', 'farm-pond', 'farm-tree-1', 'farm-tree-2', 'farm-tree-3', 'farm-tree-4']) {
    const object = scene.getObjectByName(name);
    assert.ok(object, name);
    const box = new THREE.Box3().setFromObject(object);
    assert.ok(box.min.x >= -half - 1e-6 && box.max.x <= half + 1e-6, `${name} crosses the X rim`);
    assert.ok(box.min.z >= -half - 1e-6 && box.max.z <= half + 1e-6, `${name} crosses the Z rim`);
  }
});

test('the default desktop view frames the complete slab and surrounding void', () => {
  const { camera, follow, resize } = createIsometricCamera();
  resize(1280, 720);
  follow(new THREE.Vector3(0, GROUND_HEIGHT, 0));
  camera.updateMatrixWorld();
  const half = GROUND_SIZE / 2;
  for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [ISLAND_BOTTOM, GROUND_HEIGHT]) {
    const projected = new THREE.Vector3(x, y, z).project(camera);
    assert.ok(Math.abs(projected.x) < 0.99 && Math.abs(projected.y) < 0.99, `clipped corner ${x}, ${y}, ${z}`);
  }
});
