import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';
import { readBible } from '../tools/assetgen/config.mjs';
import { inspectSignedGroup } from '../tools/assetgen/geometry.mjs';
import { isolateHistoricalGarden, restoreHistoricalGarden } from '../tools/historical-garden-isolation.mjs';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { FARM_PALETTE } = await vite.ssrLoadModule('/src/scene/farmPalette.ts');
const { ASSET_PALETTE } = await vite.ssrLoadModule('/src/assets/palette.ts');
const { createGardenDressing } = await vite.ssrLoadModule('/src/scene/gardenDressing/createGardenDressing.ts');
const { createGardenPlot } = await vite.ssrLoadModule('/src/scene/gardenDressing/createGardenPlot.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createFarmDecorations } = await vite.ssrLoadModule('/src/scene/createFarmDecorations.ts');
const { createIsland, GROUND_HEIGHT } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { createSheepfold } = await vite.ssrLoadModule('/src/scene/sheepfold/createSheepfold.ts');
const { createPlacementVisual, makeGhost } = await vite.ssrLoadModule('/src/placement/createPlacementVisual.ts');
const { createPlacementSystem } = await vite.ssrLoadModule('/src/placement/placementSystem.ts');
const { intersectsFootprint } = await vite.ssrLoadModule('/src/placement/grid.ts');
const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
after(() => vite.close());

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

function boxFootprint(box) {
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}

function liveFarm() {
  const scene = new THREE.Scene();
  const { stairs } = createIsland(scene);
  const layout = createFarmLayout(scene);
  const fold = createSheepfold(scene, 123);
  const scenery = createFarmDecorations(scene, GROUND_HEIGHT);
  const garden = createGardenDressing(scene);
  scene.updateMatrixWorld(true);
  const reservations = [...layout.obstacles, ...fold.obstacles];
  const sceneryBounds = scenery.map((object) => ({ kind: 'box', name: object.name, ...boxFootprint(new THREE.Box3().setFromObject(object)) }));
  const stairBounds = [...stairs.treads, stairs.footPad]
    .map((object) => ({ kind: 'box', name: object.name, ...boxFootprint(new THREE.Box3().setFromObject(object)) }));
  return { scene, garden, reservations: [...reservations, ...sceneryBounds, ...stairBounds] };
}

test('approved soil and flower tokens have the exact Look Dev values', () => {
  const expected = { soil: 0x5f4630, 'flower.red': 0xc75b46, 'flower.yellow': 0xf2c94c,
    'flower.blue': 0x6a8fd0, 'flower.orange': 0xe08a3c };
  for (const [token, value] of Object.entries(expected)) assert.equal(ASSET_PALETTE[token], value, token);
  assert.deepEqual([FARM_PALETTE.soil, FARM_PALETTE.flowerRed, FARM_PALETTE.flowerYellow,
    FARM_PALETTE.flowerBlue, FARM_PALETTE.flowerOrange], Object.values(expected));
  assert.notEqual(FARM_PALETTE.soil, FARM_PALETTE.dirt);
});

test('plot fits the original two tiles, with a timber frame, soil and two alternating seedling rows', () => {
  const plot = createGardenPlot();
  plot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(plot);
  const size = box.getSize(new THREE.Vector3());
  near(size.x, 2.94); near(size.z, 1.44); near(box.min.y, 0);

  const soil = plot.getObjectByName('garden-plot-soil');
  const soilBox = new THREE.Box3().setFromObject(soil);
  assert.equal(soil.material.color.getHex(), 0x5f4630);
  near(soilBox.max.y, 0.1);
  const edges = plot.getObjectsByProperty('name', 'garden-plot-frame');
  assert.equal(edges.length, 4);
  for (const edge of edges) {
    const bounds = new THREE.Box3().setFromObject(edge);
    const dimensions = bounds.getSize(new THREE.Vector3());
    near(dimensions.y, 0.14);
    near(Math.min(dimensions.x, dimensions.z), 0.14);
    near(soilBox.max.y - bounds.min.y, 0.04);
    assert.ok(bounds.max.y > soilBox.max.y);
    assert.equal(edge.material.color.getHex(), 0x8b5e3c);
  }

  const seedlings = plot.getObjectsByProperty('name', 'garden-plot-seedling');
  assert.equal(seedlings.length, 8);
  const rows = [...new Set(seedlings.map((seedling) => seedling.position.z))].sort((a, b) => a - b);
  assert.equal(rows.length, 2);
  for (const [index, z] of rows.entries()) {
    const row = seedlings.filter((seedling) => seedling.position.z === z).sort((a, b) => a.position.x - b.position.x);
    assert.equal(row.length, 4);
    row.forEach((seedling, column) => {
      const dimensions = new THREE.Box3().setFromObject(seedling).getSize(new THREE.Vector3());
      near(dimensions.x, 0.2); near(dimensions.y, 0.22); near(dimensions.z, 0.2);
      assert.equal(seedling.material.color.getHex(), (index + column) % 2 ? 0x7cbc5a : 0x5fa846);
      assert.ok(seedling.position.y - dimensions.y / 2 <= soilBox.max.y);
    });
  }
  for (const part of plot.children) {
    assert.equal(part.material.roughness, 1);
    assert.equal(part.material.emissive.getHex(), 0);
  }
});

test('plot ghost uses the actual parts at half opacity without recolouring them', () => {
  const placed = createPlacementVisual('plot');
  const ghost = createPlacementVisual('plot');
  makeGhost(ghost);
  assert.deepEqual(ghost.children.map((part) => [part.name, part.material.color.getHex()]),
    placed.children.map((part) => [part.name, part.material.color.getHex()]));
  for (const part of ghost.children) {
    assert.equal(part.material.opacity, 0.5);
    assert.equal(part.material.transparent, true);
    assert.equal(part.material.depthWrite, false);
  }
});

test('fixed hives and flower patches are clear of live colliders and placement reservations', () => {
  const { scene, garden, reservations } = liveFarm();
  const hivePositions = [[-6.7, -3.5], [-6.7, -4.3]];
  assert.equal(garden.obstacles.length, 2);
  assert.equal(garden.clickTargets.length, 2);
  for (const [index, [x, z]] of hivePositions.entries()) {
    const name = `beehive-${index + 1}`;
    const hive = scene.getObjectByName(name);
    const body = hive.getObjectByName(`${name}-body`);
    const bodyBox = new THREE.Box3().setFromObject(body);
    const obstacle = garden.obstacles[index];
    assert.deepEqual(hive.position.toArray(), [x, GROUND_HEIGHT, z]);
    assert.equal(obstacle.name, name);
    assert.equal(obstacle.kind, 'box');
    assert.notEqual(obstacle.blocksWalking, false);
    near(bodyBox.max.x - bodyBox.min.x, 0.7); near(bodyBox.max.z - bodyBox.min.z, 0.7);
    near(bodyBox.max.y - bodyBox.min.y, 0.45);
    near(obstacle.minX, bodyBox.min.x); near(obstacle.maxX, bodyBox.max.x);
    near(obstacle.minZ, bodyBox.min.z); near(obstacle.maxZ, bodyBox.max.z);
    const roof = new THREE.Box3().setFromObject(hive.getObjectByName(`${name}-roof`));
    near(roof.max.x - roof.min.x, 0.86); near(roof.max.z - roof.min.z, 0.86);
    near(roof.max.y - GROUND_HEIGHT, 0.8);
    for (const existing of reservations) assert.equal(intersectsFootprint(obstacle, existing), false, `${name} overlaps ${existing.name}`);
  }
  assert.equal(intersectsFootprint(garden.obstacles[0], garden.obstacles[1]), false);

  const patches = [[-1.2, 4.1, 0xc75b46], [1.4, 4.6, 0xf2c94c], [-7, 0.9, 0x6a8fd0], [6, 4.5, 0xe08a3c]];
  const layouts = new Set();
  for (const [index, [x, z, color]] of patches.entries()) {
    const patch = scene.getObjectByName(`flower-patch-${index + 1}`);
    assert.deepEqual(patch.position.toArray(), [x, GROUND_HEIGHT, z]);
    const bounds = new THREE.Box3().setFromObject(patch);
    assert.ok(bounds.min.x >= x - 0.4 - 1e-6 && bounds.max.x <= x + 0.4 + 1e-6);
    assert.ok(bounds.min.z >= z - 0.4 - 1e-6 && bounds.max.z <= z + 0.4 + 1e-6);
    const footprint = { minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 };
    for (const obstacle of [...reservations, ...garden.obstacles]) {
      assert.equal(intersectsFootprint(footprint, obstacle), false, `${patch.name} overlaps ${obstacle.name}`);
    }
    const heads = patch.getObjectsByProperty('name', 'flower-head');
    const stems = patch.getObjectsByProperty('name', 'flower-stem');
    assert.ok(heads.length >= 6 && heads.length <= 8);
    assert.equal(stems.length, heads.length);
    layouts.add(stems.map((stem) => `${stem.position.x},${stem.position.z}`).sort().join(';'));
    for (const head of heads) {
      assert.equal(head.material.color.getHex(), color);
      assert.equal(head.material.emissive.getHex(), 0);
      const size = new THREE.Box3().setFromObject(head).getSize(new THREE.Vector3());
      assert.ok(size.x >= 0.15 - 1e-6 && size.x <= 0.2 + 1e-6);
      assert.ok(size.z >= 0.15 - 1e-6 && size.z <= 0.2 + 1e-6);
    }
    for (const stem of stems) {
      const size = new THREE.Box3().setFromObject(stem).getSize(new THREE.Vector3());
      near(size.x, 0.11); near(size.y, 0.2); near(size.z, 0.11);
    }
  }
  assert.equal(layouts.size, 4, 'the flower patches must have distinct arrangements');
});

test('garden dressing is matte, flat-shaded, palette-only and non-emissive', () => {
  const { scene } = liveFarm();
  const allowed = new Set([0xc8956c, 0x8b5e3c, 0x3d7a3a, 0xc75b46, 0xf2c94c, 0x6a8fd0, 0xe08a3c]);
  for (const groupName of ['garden-beehives', 'garden-flower-patches']) {
    scene.getObjectByName(groupName).traverse((object) => {
      assert.equal(object.isLight, undefined, object.name);
      if (!object.isMesh || object.name.endsWith('-shadow')) return;
      assert.equal(object.material.isMeshStandardMaterial, true, object.name);
      assert.equal(object.material.roughness, 1, object.name);
      assert.equal(object.material.flatShading, true, object.name);
      assert.equal(object.material.emissive.getHex(), 0, object.name);
      assert.equal(object.material.map, null, object.name);
      assert.equal(object.material.transparent, false, object.name);
      assert.ok(allowed.has(object.material.color.getHex()), `off-palette ${object.name}`);
    });
  }
});

test('plot, hives and flowers have connected, non-coplanar joins', async () => {
  const { rules } = await readBible();
  const { scene } = liveFarm();
  for (const [name, group, ground] of [
    ['plot', createGardenPlot(), 0],
    ['hives', scene.getObjectByName('garden-beehives').clone(), GROUND_HEIGHT],
    ['flowers', scene.getObjectByName('garden-flower-patches').clone(), GROUND_HEIGHT],
  ]) {
    // Contact shadows are supplied by the scene and are not solid asset parts.
    const shadows = [];
    group.traverse((object) => { if (object.name.endsWith('-shadow')) shadows.push(object); });
    shadows.forEach((object) => object.removeFromParent());
    const metrics = inspectSignedGroup(group, rules, ASSET_PALETTE, 'prop', ground);
    assert.equal(metrics.zFightPairs, 0, `${name}: ${metrics.zFightExamples.join(', ')}`);
    assert.equal(metrics.nonFinite, 0, name);
    assert.equal(metrics.degenerate, 0, name);
    assert.deepEqual(metrics.disconnectedParts, [], name);
    assert.deepEqual(metrics.offPalette, [], name);
  }
});

test('historical screenshot isolation is reversible and leaves unrelated visuals and collisions alone', () => {
  const { scene, garden } = liveFarm();
  const placed = createPlacementVisual('plot'); placed.name = 'placed-plot'; scene.add(placed);
  const ghost = createPlacementVisual('plot'); ghost.name = 'placement-ghost'; scene.add(ghost);
  const fence = createPlacementVisual('fence'); fence.name = 'unrelated-fence'; scene.add(fence);
  const tree = scene.getObjectByName('farm-tree-4');
  const shadow = scene.getObjectByName('farm-tree-shadow-4');
  shadow.position.set(0.2, 0.003, -0.1);
  shadow.scale.x = 1.1;
  const before = { position: tree.position.toArray(), scale: tree.scale.toArray(),
    shadowPosition: shadow.position.toArray(), shadowScale: shadow.scale.toArray(), obstacles: structuredClone(garden.obstacles) };
  const originalWindow = globalThis.window, originalDocument = globalThis.document;
  globalThis.window = { __gardenIsolationTest: { scene } };
  globalThis.document = { querySelector: () => ({ getAttribute: () => 'true' }) };
  try {
    const state = isolateHistoricalGarden({ contextName: '__gardenIsolationTest', hidePlots: true });
    assert.deepEqual(tree.position.toArray(), [0.05, GROUND_HEIGHT, -5.6]);
    near(tree.scale.x, 0.95);
    assert.equal(scene.getObjectByName('garden-beehives').visible, false);
    assert.equal(scene.getObjectByName('garden-flower-patches').visible, false);
    assert.equal(placed.visible, false); assert.equal(ghost.visible, false); assert.equal(fence.visible, true);
    assert.deepEqual(garden.obstacles, before.obstacles);
    restoreHistoricalGarden({ contextName: '__gardenIsolationTest', state });
    assert.deepEqual(tree.position.toArray(), before.position); assert.deepEqual(tree.scale.toArray(), before.scale);
    assert.deepEqual(shadow.position.toArray(), before.shadowPosition); assert.deepEqual(shadow.scale.toArray(), before.shadowScale);
    assert.ok([placed, ghost, fence, scene.getObjectByName('garden-beehives'), scene.getObjectByName('garden-flower-patches')]
      .every((object) => object.visible));
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});

test('garden contact shadows follow the existing light and weather strength', () => {
  const { scene, garden } = liveFarm();
  garden.updateShadows(0.8, -0.6, 0.4, 1);
  for (let i = 1; i <= 2; i++) {
    const shadow = scene.getObjectByName(`beehive-${i}-shadow`);
    near(shadow.position.x, 0.16); near(shadow.position.z, -0.12); near(shadow.material.opacity, 0.12);
  }
  for (let i = 1; i <= 4; i++) {
    const shadow = scene.getObjectByName(`flower-patch-${i}-shadow`);
    near(shadow.position.x, 0.064); near(shadow.position.z, -0.048); near(shadow.material.opacity, 0.07);
  }
  garden.updateShadows(-0.6, 0.8, 0.1, 0.25);
  const hive = scene.getObjectByName('beehive-1-shadow');
  const flowers = scene.getObjectByName('flower-patch-1-shadow');
  near(hive.position.x, -0.03); near(hive.position.z, 0.04); near(hive.material.opacity, 0.03);
  near(flowers.position.x, -0.012); near(flowers.position.z, 0.016); near(flowers.material.opacity, 0.0175);
});

test('placement rejects every hive-overlapping tile in all rotations but not flower scenery', () => {
  const { garden } = liveFarm();
  const world = createEntityWorld();
  for (const obstacle of garden.obstacles) world.create({ obstacle });
  const system = createPlacementSystem(world, 16, GROUND_HEIGHT);
  const action = (type, extra = {}, hit = null) => system.dispatch({ type, ...extra }, hit);
  let rejected = 0;
  for (const kind of ['fence', 'plot']) for (let rotation = 0; rotation < 4; rotation++) {
    action('placement-select', { kind });
    for (let turn = 0; turn < rotation; turn++) action('placement-rotate');
    for (let column = 0; column < system.grid.count; column++) for (let row = 0; row < system.grid.count; row++) {
      const area = system.grid.footprint({ column, row }, kind, rotation);
      const overlaps = garden.obstacles.some((hive) => area.minX < hive.maxX && area.maxX > hive.minX &&
        area.minZ < hive.maxZ && area.maxZ > hive.minZ);
      if (!system.grid.contains(area) || !overlaps) continue;
      const hit = { x: system.grid.min + (column + 0.5) * 1.5, z: system.grid.min + (row + 0.5) * 1.5 };
      action('placement-preview', { point: { x: 10, y: 10 } }, hit);
      assert.equal(system.state.valid, false, `${kind} rotation ${rotation} at ${hit.x},${hit.z}`);
      assert.match(system.state.message, /Blocked by a farm object/);
      action('placement-confirm', {}, hit);
      rejected++;
    }
  }
  assert.ok(rejected >= 16);
  assert.equal([...world.with('placed')].length, 0);
  action('placement-select', { kind: 'fence' });
  for (const [x, z] of [[-1.2, 4.1], [1.4, 4.6], [-7, 0.9], [6, 4.5]]) {
    action('placement-preview', { point: { x: 10, y: 10 } }, { x, z });
    assert.equal(system.state.valid, true, `flowers at ${x},${z} must not reserve placement`);
  }
});

test('tree 4 and its collision move together without entering the path, pond or stream', () => {
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const tree = scene.getObjectByName('farm-tree-4');
  const collider = obstacles.find((obstacle) => obstacle.name === 'tree-4');
  assert.deepEqual(tree.position.toArray(), [-0.35, GROUND_HEIGHT, -5.8]);
  near(tree.scale.x, 0.9);
  assert.ok(Math.hypot(tree.position.x - 0.05, tree.position.z + 5.6) < 0.5);
  near(collider.x, tree.position.x); near(collider.z, tree.position.z); near(collider.radius, 0.32 * 0.9);
  const footprint = boxFootprint(new THREE.Box3().setFromObject(tree));
  for (const obstacle of obstacles.filter((entry) => entry.name === 'pond' || entry.name.startsWith('stream-'))) {
    assert.equal(intersectsFootprint(footprint, obstacle), false, obstacle.name);
  }
  const path = boxFootprint(new THREE.Box3().setFromObject(scene.getObjectByName('farm-path-edge')));
  assert.equal(intersectsFootprint(footprint, { kind: 'box', name: 'path', ...path }), false);
});
