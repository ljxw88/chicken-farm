import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createWaterFeature } = await vite.ssrLoadModule('/src/scene/createWaterFeature.ts');
const { WATER_FEATURE } = await vite.ssrLoadModule('/src/scene/waterFeatureSpec.ts');
const { moveWithFarmCollisions } = await vite.ssrLoadModule('/src/scene/farmCollisions.ts');
const { createGrid, intersectsFootprint, TILE_SIZE } = await vite.ssrLoadModule('/src/placement/grid.ts');
const { GROUND_HEIGHT } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

const farPond = { kind: 'box', name: 'pond', minX: -7, maxX: -6, minZ: -7, maxZ: -6 };

function spec() {
  return {
    stream: { points: [{ x: -6, z: 0 }, { x: 8, z: 0 }], width: 2, surfaceLift: 0.03 },
    bridge: { x: 0, z: 0, length: 4, width: 2, rotationDegrees: 90, thickness: 0.02, topLift: 0.04, walkRule: 'walkable' },
    waterfall: { side: 'east', width: null, lipDepth: 0.75, drop: 2.4 },
    palette: { stream: 0x5b8fa8, waterfall: 0x5b8fa8, bridge: 0xd4a574 },
  };
}

function feature(options = spec(), pond = farPond) {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  scene.add(parent);
  const obstacles = createWaterFeature(parent, pond, options);
  scene.updateMatrixWorld(true);
  return { scene, obstacles };
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

test('water stops a circular character while a walkable deck crosses from either bank', () => {
  const { obstacles } = feature();
  const offBridge = moveWithFarmCollisions(-3, -2, 0, 4, 0.4, obstacles);
  assert.ok(offBridge.z <= -1.4 && offBridge.z > -1.51, `water did not stop walking: ${offBridge.z}`);
  for (const sign of [-1, 1]) {
    const crossed = moveWithFarmCollisions(0, sign * 2.5, 0, -sign * 5, 0.4, obstacles);
    near(crossed.x, 0);
    near(crossed.z, -sign * 2.5);
  }
  // A centre on the deck is insufficient if the player's radius hangs over water.
  const tooCloseToSide = moveWithFarmCollisions(0.75, -2.5, 0, 5, 0.4, obstacles);
  assert.ok(tooCloseToSide.z < -1.3 && tooCloseToSide.z > -1.5);
  const insideSide = moveWithFarmCollisions(0.59, -2.5, 0, 5, 0.4, obstacles);
  near(insideSide.z, 2.5);
});

test('blocked bridge rule blocks the deck itself, including its dry overhang', () => {
  const options = spec();
  options.bridge.walkRule = 'blocked';
  const { obstacles } = feature(options);
  const bridge = obstacles.find((entry) => entry.name === 'wooden-bridge');
  assert.equal(bridge.blocksWalking, true);
  const stopped = moveWithFarmCollisions(0, -3, 0, 6, 0.4, obstacles);
  assert.ok(stopped.z <= -2.4 && stopped.z > -2.51, `blocked deck was crossed: ${stopped.z}`);
});

test('the full 1.5-unit tile rejects water, the waterfall lip and even a walkable dry deck overhang', () => {
  const options = spec();
  const grid = createGrid(16);
  assert.equal(TILE_SIZE, 1.5);
  for (const rule of ['walkable', 'blocked']) {
    options.bridge.walkRule = rule;
    const { obstacles } = feature(options);
    const stream = obstacles.filter((entry) => entry.name.startsWith('stream-'));
    const lip = obstacles.filter((entry) => entry.name.startsWith('waterfall-edge-'));
    const bridge = obstacles.find((entry) => entry.name === 'wooden-bridge');
    const tile = (x, z) => grid.footprint(grid.cellAt(x, z), 'fence', 0);
    assert.ok(stream.some((zone) => intersectsFootprint(tile(-3.75, 0.75), zone)));
    assert.ok(lip.some((zone) => intersectsFootprint(tile(6.75, 0.75), zone)));
    const overhang = tile(0.75, 2.25); // Its centre is off both the water and the deck.
    assert.ok(stream.every((zone) => !intersectsFootprint(overhang, zone)));
    assert.equal(intersectsFootprint(overhang, bridge), true);
    assert.equal(intersectsFootprint(tile(2.25, 2.25), bridge), false);
  }
});

test('rotated bridge tile tests use its actual polygon, not its larger bounding box', () => {
  const options = spec();
  Object.assign(options.bridge, { length: 4, width: 1, rotationDegrees: 45 });
  const bridge = feature(options).obstacles.find((entry) => entry.name === 'wooden-bridge');
  const grid = createGrid(16);
  const corner = grid.footprint(grid.cellAt(2.25, 2.25), 'fence', 0);
  assert.ok(corner.minX < bridge.maxX && corner.minZ < bridge.maxZ); // AABBs overlap.
  assert.equal(intersectsFootprint(corner, bridge), false);
  const partial = grid.footprint(grid.cellAt(2.25, -0.75), 'fence', 0);
  assert.equal(intersectsFootprint(partial, bridge), true);
});

test('diagonal stream and rotated deck have matching, radius-aware walking footprints', () => {
  const options = spec();
  options.stream.points = [{ x: -4, z: -3 }, { x: 8, z: 3 }];
  Object.assign(options.bridge, { x: 0, z: -1, rotationDegrees: 63.43494882292201 });
  const { obstacles } = feature(options);
  const normal = { x: -1 / Math.sqrt(5), z: 2 / Math.sqrt(5) };
  const tangent = { x: 2 / Math.sqrt(5), z: 1 / Math.sqrt(5) };
  const crossing = (offset) => moveWithFarmCollisions(
    tangent.x * offset - normal.x * 2.5, -1 + tangent.z * offset - normal.z * 2.5,
    normal.x * 5, normal.z * 5, 0.25, obstacles,
  );
  const acrossDeck = crossing(0);
  near(acrossDeck.x, normal.x * 2.5);
  near(acrossDeck.z, -1 + normal.z * 2.5);
  const acrossWater = crossing(3);
  const signedDistance = (acrossWater.x - tangent.x * 3) * normal.x +
    (acrossWater.z + 1 - tangent.z * 3) * normal.z;
  assert.ok(signedDistance < -1.2, `crossed diagonal water: ${signedDistance}`);
});

test('a walkable deck cuts pond water too, but never cuts a building obstacle', () => {
  const options = spec();
  options.bridge.length = 6;
  const pond = { kind: 'box', name: 'pond', minX: -2, maxX: 2, minZ: -2, maxZ: 2 };
  const { obstacles } = feature(options, pond);
  const crossed = moveWithFarmCollisions(0, -3.5, 0, 7, 0.4, obstacles);
  near(crossed.z, 3.5);
  const besideDeck = moveWithFarmCollisions(1.6, -3.5, 0, 7, 0.4, obstacles);
  assert.ok(besideDeck.z <= -2.4 && besideDeck.z > -2.51);
  const building = { kind: 'box', name: 'cottage', minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 };
  const blockedByBuilding = moveWithFarmCollisions(0, -3.5, 0, 7, 0.4, [...obstacles, building]);
  assert.ok(blockedByBuilding.z <= -0.9 && blockedByBuilding.z > -1.01);
  const tile = createGrid(16).footprint({ column: 5, row: 5 }, 'fence', 0);
  assert.ok(obstacles.some((obstacle) => intersectsFootprint(tile, obstacle)), 'pond/deck must remain a placement keep-out');
});

test('bend water has no collision or rendering gap and the waterfall meets the island edge', () => {
  const options = spec();
  options.stream.points = [{ x: -6, z: 0 }, { x: -3, z: 0 }, { x: -3, z: 3 }, { x: 8, z: 3 }];
  const { scene, obstacles } = feature(options);
  const bend = scene.getObjectByName('farm-stream-bend-1');
  assert.ok(bend);
  const ray = new THREE.Raycaster(new THREE.Vector3(-2.5, 10, -0.5), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(bend).length, 'missing the outside of the bend');
  const blocked = moveWithFarmCollisions(-2.5, -2, 0, 2, 0.1, obstacles);
  assert.ok(blocked.z < -0.5);
  const fall = scene.getObjectByName('farm-waterfall-face');
  near(fall.position.x, 8);
  near(fall.position.z, 3);
  near(fall.geometry.parameters.width, 2);
  near(fall.geometry.parameters.height, 2.4);
  const waterfallRay = new THREE.Raycaster(new THREE.Vector3(9, 1, 3), new THREE.Vector3(-1, 0, 0));
  assert.ok(waterfallRay.intersectObject(fall).length, 'waterfall face must face outwards');
  assert.ok(obstacles.some((obstacle) => obstacle.name.startsWith('waterfall-edge-')));
});

test('the waterfall face and lip follow any selected island edge', () => {
  for (const [side, x, z, nx, nz] of [
    ['east', 8, 1, 1, 0], ['west', -8, 1, -1, 0],
    ['north', 1, -8, 0, -1], ['south', 1, 8, 0, 1],
  ]) {
    const options = spec();
    options.stream.points = [{ x: 0, z: 0 }, { x, z }];
    options.waterfall.side = side;
    const { scene, obstacles } = feature(options);
    const face = scene.getObjectByName('farm-waterfall-face');
    near(face.position.x, x);
    near(face.position.z, z);
    const ray = new THREE.Raycaster(new THREE.Vector3(x + nx, 1, z + nz), new THREE.Vector3(-nx, 0, -nz));
    assert.ok(ray.intersectObject(face).length, `${side} face points the wrong way`);
    const lip = obstacles.filter((obstacle) => obstacle.name.startsWith('waterfall-edge-'));
    assert.ok(lip.length, `${side} has no lip collision`);
    const stopped = moveWithFarmCollisions(x - nx * 2, z - nz * 2, nx * 3, nz * 3, 0.4, lip);
    const remaining = (x - stopped.x) * nx + (z - stopped.z) * nz;
    assert.ok(remaining >= 1.15 && remaining < 1.26, `${side} lip stopped ${remaining} from edge`);
  }
});

test('changing the single table updates the real layout meshes, zones and rule together', () => {
  const original = structuredClone(WATER_FEATURE);
  try {
    WATER_FEATURE.stream.points = [{ x: 5.2, z: -4.25 }, { x: 5.6, z: -6.5 }, { x: 8, z: -6.5 }];
    WATER_FEATURE.stream.width = 0.8;
    Object.assign(WATER_FEATURE.bridge, { x: 6.7, z: -6.5, length: 2.6, width: 1.6, walkRule: 'blocked' });
    Object.assign(WATER_FEATURE.waterfall, { width: 1.4, drop: 1.8 });
    Object.assign(WATER_FEATURE.palette, { stream: 0x123456, bridge: 0x654321, waterfall: 0xabcdef });
    const scene = new THREE.Scene();
    const { obstacles } = createFarmLayout(scene);
    scene.updateMatrixWorld(true);
    const deck = scene.getObjectByName('farm-wooden-bridge');
    near(deck.position.x, 6.7);
    near(deck.position.z, -6.5);
    near(deck.geometry.parameters.width, 2.6);
    near(deck.geometry.parameters.depth, 1.6);
    assert.equal(deck.material.color.getHex(), 0x654321);
    assert.equal(obstacles.find((entry) => entry.name === 'wooden-bridge').blocksWalking, true);
    const blocked = moveWithFarmCollisions(6.7, -4.6, 0, -4, 0.4, obstacles);
    assert.ok(blocked.z >= -4.8 && blocked.z < -4.69);
    const water = scene.getObjectByName('farm-stream-segment-2');
    assert.equal(water.material.color.getHex(), 0x123456);
    const box = new THREE.Box3().setFromObject(water);
    near(box.min.z, -6.9, 1e-5);
    near(box.max.z, -6.1, 1e-5);
    const fall = scene.getObjectByName('farm-waterfall-face');
    near(fall.position.z, -6.5);
    near(fall.geometry.parameters.width, 1.4);
    near(fall.geometry.parameters.height, 1.8);
    assert.equal(fall.material.color.getHex(), 0xabcdef);
    near(fall.position.y + 1.8 / 2, GROUND_HEIGHT + WATER_FEATURE.stream.surfaceLift);
  } finally {
    Object.assign(WATER_FEATURE, original);
  }
});
