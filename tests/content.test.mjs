import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { ART_SLOTS } = await vite.ssrLoadModule('/src/content/slots.ts');
const { FARM_BUILDINGS } = await vite.ssrLoadModule('/src/content/buildings.ts');
const { FARM_LAYOUT, FARM_DECORATIONS } = await vite.ssrLoadModule('/src/content/farm.ts');
const { ISLAND, STAIR, GRID } = await vite.ssrLoadModule('/src/content/world.ts');
const { PATH_GEOMETRY, TREE_GEOMETRY, POND_GEOMETRY, GRASS_GEOMETRY } = await vite.ssrLoadModule('/src/content/propGeometry.ts');
const { CHICKEN_GEOMETRY, NEST_GEOMETRY, DECORATION_GEOMETRY } = await vite.ssrLoadModule('/src/content/decorationGeometry.ts');
const { WATER_FEATURE } = await vite.ssrLoadModule('/src/content/waterFeature.ts');
const { DAY_NIGHT_PHASES, WINDOW_LIGHT, LANTERN_LIGHT } = await vite.ssrLoadModule('/src/content/dayNight.ts');
const { RAIN_LOOK } = await vite.ssrLoadModule('/src/content/rainSettings.ts');
const { CLOUDY_LOOK } = await vite.ssrLoadModule('/src/content/cloudySettings.ts');
const { PIXEL_PRESENTATION } = await vite.ssrLoadModule('/src/content/presentation.ts');
const { COTTAGE_GEOMETRY, COOP_GEOMETRY, GABLE_GEOMETRY } = await vite.ssrLoadModule('/src/content/buildingGeometry.ts');
const { PLAYER_GEOMETRY } = await vite.ssrLoadModule('/src/content/playerGeometry.ts');
const { PLACEMENT_GEOMETRY } = await vite.ssrLoadModule('/src/content/placementGeometry.ts');
const { KEY_LIGHT_GEOMETRY, PRACTICAL_LIGHT_GEOMETRY, FARM_SHADOW_GEOMETRY } = await vite.ssrLoadModule('/src/content/lightGeometry.ts');
const { CAMERA } = await vite.ssrLoadModule('/src/content/camera.ts');
const { RAIN_INITIAL_OPACITY } = await vite.ssrLoadModule('/src/content/weatherVisual.ts');
const { createFarmBuildings } = await vite.ssrLoadModule('/src/scene/createFarmBuildings.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createPlacementAsset } = await vite.ssrLoadModule('/src/render/placementAssets.ts');
const { createStoneStairs } = await vite.ssrLoadModule('/src/scene/createStoneStairs.ts');
after(() => vite.close());

function assertPlain(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return; }
  assert.equal(typeof value, 'object');
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
  assert.deepEqual(Object.getOwnPropertySymbols(value), []);
  for (const item of Object.values(value)) assertPlain(item);
}

test('content and slots are plain finite JSON data with separate dimensions and footprints', () => {
  const content = { ART_SLOTS, FARM_BUILDINGS, FARM_LAYOUT, FARM_DECORATIONS, ISLAND, STAIR, GRID,
    PATH_GEOMETRY, TREE_GEOMETRY, POND_GEOMETRY, GRASS_GEOMETRY, CHICKEN_GEOMETRY, NEST_GEOMETRY,
    DECORATION_GEOMETRY, WATER_FEATURE, DAY_NIGHT_PHASES, WINDOW_LIGHT, LANTERN_LIGHT, RAIN_LOOK,
    CLOUDY_LOOK, PIXEL_PRESENTATION, COTTAGE_GEOMETRY, COOP_GEOMETRY, GABLE_GEOMETRY, PLAYER_GEOMETRY,
    PLACEMENT_GEOMETRY, KEY_LIGHT_GEOMETRY, PRACTICAL_LIGHT_GEOMETRY, FARM_SHADOW_GEOMETRY, CAMERA, RAIN_INITIAL_OPACITY };
  assertPlain(content);
  assert.deepEqual(JSON.parse(JSON.stringify(content)), content);
  assert.deepEqual(GRID.footprints, { fence: { columns: 1, rows: 1 }, plot: { columns: 2, rows: 1 } });
  assert.equal('width' in ART_SLOTS.building.cottage, false);
  assert.equal('footprint' in ART_SLOTS.building.coop, false);
  assert.equal('cssPixelSize' in ART_SLOTS.post.pixel, false);
  assert.equal('width' in ART_SLOTS.prop.stair, false);
});

test('placement asset IDs resolve only through known render factories', () => {
  assert.equal(createPlacementAsset('fence').name, 'placement-fence-visual');
  assert.equal(createPlacementAsset('plot').name, 'placement-plot-visual');
  assert.throws(() => createPlacementAsset('toString'), /Unknown placement asset/);
  assert.throws(() => createPlacementAsset('missing'), /Unknown placement asset/);
});

test('building art slots can be swapped independently without changing geometry or collisions', () => {
  const baseline = new THREE.Group();
  const reference = createFarmBuildings(baseline);
  const slots = structuredClone(ART_SLOTS.building);
  slots.cottage.plaster = 0x123456;
  slots.cottage.timber = 0x223344;
  slots.cottage.glass = 0x334455;
  slots.cottage.shingle = 0x445566;
  slots.coop.timber = 0x556677;
  slots.coop.roof = 0x667788;
  const swapped = new THREE.Group();
  const actual = createFarmBuildings(swapped, FARM_BUILDINGS, slots);
  assert.equal(swapped.getObjectByName('cottage-walls').material.color.getHex(), 0x123456);
  assert.equal(swapped.getObjectByName('cottage-corner-post').material.color.getHex(), 0x223344);
  assert.equal(swapped.getObjectByName('cottage-window-1').material.color.getHex(), 0x334455);
  assert.equal(swapped.getObjectByName('cottage-shingle-band').material.color.getHex(), 0x445566);
  assert.equal(swapped.getObjectByName('ramp-coop-1-corner-trim').material.color.getHex(), 0x556677);
  assert.equal(swapped.getObjectByName('ramp-coop-1-roof-slope').material.color.getHex(), 0x667788);
  assert.deepEqual(actual.obstacles, reference.obstacles);
  assert.deepEqual(actual.splashExclusions, reference.splashExclusions);
  assert.deepEqual(new THREE.Box3().setFromObject(swapped), new THREE.Box3().setFromObject(baseline));
});

test('farm prop factories use data positions and the same values for their footprints', () => {
  const layout = structuredClone(FARM_LAYOUT);
  layout.trees[0].x = -1.25;
  layout.trees[0].z = 2.25;
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene, layout);
  assert.deepEqual(scene.getObjectByName('farm-tree-1').position.toArray(), [-1.25, ISLAND.groundHeight, 2.25]);
  assert.deepEqual(obstacles.find((obstacle) => obstacle.name === 'tree-1'),
    { kind: 'circle', name: 'tree-1', x: -1.25, z: 2.25, radius: TREE_GEOMETRY.collisionRadius * layout.trees[0].scale });
});

test('stair art slots can change without changing the walking surface or geometry', () => {
  const baselineGroup = new THREE.Group();
  const changedGroup = new THREE.Group();
  const baseline = createStoneStairs(baselineGroup, ISLAND.size, ISLAND.groundHeight, ISLAND.bottom);
  const slots = { ...ART_SLOTS.prop.stair, treadMixes: ART_SLOTS.prop.stair.treadMixes.map(() => 0.35), stoneMix: 0.45 };
  const changed = createStoneStairs(changedGroup, ISLAND.size, ISLAND.groundHeight, ISLAND.bottom, slots);
  assert.deepEqual(changed.surface, baseline.surface);
  assert.deepEqual(new THREE.Box3().setFromObject(changedGroup), new THREE.Box3().setFromObject(baselineGroup));
  assert.notEqual(changed.treads[0].material[2].color.getHex(), baseline.treads[0].material[2].color.getHex());
});
