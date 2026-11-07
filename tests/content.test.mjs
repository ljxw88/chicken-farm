import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { ART_SLOTS } = await vite.ssrLoadModule('/src/content/slots.ts');
const { FARM_BUILDINGS } = await vite.ssrLoadModule('/src/content/buildings.ts');
const { FARM_LAYOUT, FARM_DECORATIONS } = await vite.ssrLoadModule('/src/content/farm.ts');
const { GARDEN_DRESSING, BEEHIVE_FOOTPRINT, BEEHIVE_GEOMETRY, FLOWER_GEOMETRY } = await vite.ssrLoadModule('/src/content/garden.ts');
const { ISLAND, STAIR, GRID } = await vite.ssrLoadModule('/src/content/world.ts');
const { PATH_GEOMETRY, TREE_GEOMETRY, POND_GEOMETRY, GRASS_GEOMETRY } = await vite.ssrLoadModule('/src/content/propGeometry.ts');
const { CHICKEN_GEOMETRY, NEST_GEOMETRY, DECORATION_GEOMETRY } = await vite.ssrLoadModule('/src/content/decorationGeometry.ts');
const { WATER_FEATURE } = await vite.ssrLoadModule('/src/content/waterFeature.ts');
const { DAY_NIGHT_PHASES, DEFAULT_DAY_NIGHT_CYCLE_SECONDS, FOLLOW_DAY_NIGHT_CYCLE_SECONDS, WINDOW_LIGHT, LANTERN_LIGHT } =
  await vite.ssrLoadModule('/src/content/dayNight.ts');
const { RAIN_LOOK } = await vite.ssrLoadModule('/src/content/rainSettings.ts');
const { CLOUDY_LOOK } = await vite.ssrLoadModule('/src/content/cloudySettings.ts');
const { PIXEL_PRESENTATION } = await vite.ssrLoadModule('/src/content/presentation.ts');
const { COTTAGE_GEOMETRY, COOP_GEOMETRY, GABLE_GEOMETRY } = await vite.ssrLoadModule('/src/content/buildingGeometry.ts');
const { PLAYER_GEOMETRY } = await vite.ssrLoadModule('/src/content/playerGeometry.ts');
const { PLACEMENT_GEOMETRY } = await vite.ssrLoadModule('/src/content/placementGeometry.ts');
const { KEY_LIGHT_GEOMETRY, PRACTICAL_LIGHT_GEOMETRY, FARM_SHADOW_GEOMETRY } = await vite.ssrLoadModule('/src/content/lightGeometry.ts');
const { CAMERA } = await vite.ssrLoadModule('/src/content/camera.ts');
const { RAIN_INITIAL_OPACITY } = await vite.ssrLoadModule('/src/content/weatherVisual.ts');
const { SHEEPFOLD, LEAN_TO, SHEEPFOLD_GEOMETRY, LEAN_TO_GEOMETRY, SHEEP_GEOMETRY, DEFAULT_SHEEP_SEED } =
  await vite.ssrLoadModule('/src/content/sheep.ts');
const { FIREFLIES, CHIMNEY_SMOKE } = await vite.ssrLoadModule('/src/content/effects.ts');
const { STARTUP_OPTIONS, VISUAL_SEEDS } = await vite.ssrLoadModule('/src/content/startup.ts');
const { createFarmBuildings } = await vite.ssrLoadModule('/src/scene/createFarmBuildings.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createPlacementAsset } = await vite.ssrLoadModule('/src/render/placementAssets.ts');
const { createStoneStairs } = await vite.ssrLoadModule('/src/scene/createStoneStairs.ts');
const { createSheep } = await vite.ssrLoadModule('/src/scene/sheep/createSheep.ts');
const { createLeanTo } = await vite.ssrLoadModule('/src/scene/sheepfold/createLeanTo.ts');
const { createFireflies } = await vite.ssrLoadModule('/src/effects/createFireflies.ts');
const { createChimneySmoke } = await vite.ssrLoadModule('/src/effects/createChimneySmoke.ts');
const { SHEEPFOLD_ASSETS } = await vite.ssrLoadModule('/src/render/sheepfoldAssets.ts');
const { EFFECT_ASSETS } = await vite.ssrLoadModule('/src/render/effectAssets.ts');
const { GARDEN_ASSETS } = await vite.ssrLoadModule('/src/render/gardenAssets.ts');
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
  const content = { ART_SLOTS, FARM_BUILDINGS, FARM_LAYOUT, FARM_DECORATIONS, GARDEN_DRESSING, BEEHIVE_FOOTPRINT,
    BEEHIVE_GEOMETRY, FLOWER_GEOMETRY, ISLAND, STAIR, GRID,
    PATH_GEOMETRY, TREE_GEOMETRY, POND_GEOMETRY, GRASS_GEOMETRY, CHICKEN_GEOMETRY, NEST_GEOMETRY,
    DECORATION_GEOMETRY, WATER_FEATURE, DAY_NIGHT_PHASES, DEFAULT_DAY_NIGHT_CYCLE_SECONDS, FOLLOW_DAY_NIGHT_CYCLE_SECONDS,
    WINDOW_LIGHT, LANTERN_LIGHT, RAIN_LOOK,
    CLOUDY_LOOK, PIXEL_PRESENTATION, COTTAGE_GEOMETRY, COOP_GEOMETRY, GABLE_GEOMETRY, PLAYER_GEOMETRY,
    PLACEMENT_GEOMETRY, KEY_LIGHT_GEOMETRY, PRACTICAL_LIGHT_GEOMETRY, FARM_SHADOW_GEOMETRY, CAMERA, RAIN_INITIAL_OPACITY,
    SHEEPFOLD, LEAN_TO, SHEEPFOLD_GEOMETRY, LEAN_TO_GEOMETRY, SHEEP_GEOMETRY, DEFAULT_SHEEP_SEED,
    FIREFLIES, CHIMNEY_SMOKE, STARTUP_OPTIONS, VISUAL_SEEDS };
  assertPlain(content);
  assert.deepEqual(JSON.parse(JSON.stringify(content)), content);
  assert.deepEqual(GRID.footprints, { fence: { columns: 1, rows: 1 }, plot: { columns: 2, rows: 1 } });
  assert.equal('width' in ART_SLOTS.building.cottage, false);
  assert.equal('footprint' in ART_SLOTS.building.coop, false);
  assert.equal('cssPixelSize' in ART_SLOTS.post.pixel, false);
  assert.equal('width' in ART_SLOTS.prop.stair, false);
  assert.equal('width' in ART_SLOTS.building.sheepfold, false);
  assert.equal('radius' in ART_SLOTS.palette.sheep, false);
  assert.equal('size' in ART_SLOTS.palette.firefly, false);
  assert.equal(DEFAULT_SHEEP_SEED, VISUAL_SEEDS.sheep);
  assert.equal(DEFAULT_DAY_NIGHT_CYCLE_SECONDS, 72);
  assert.equal(FOLLOW_DAY_NIGHT_CYCLE_SECONDS, 1440);
  assert.equal(typeof SHEEPFOLD_ASSETS[SHEEPFOLD.sheepAssetId], 'function');
  assert.equal(typeof SHEEPFOLD_ASSETS[SHEEPFOLD.shelterAssetId], 'function');
  assert.equal(typeof EFFECT_ASSETS[FIREFLIES.assetId], 'function');
  assert.equal(typeof EFFECT_ASSETS[CHIMNEY_SMOKE.assetId], 'function');
  assert.equal(typeof GARDEN_ASSETS[GARDEN_DRESSING.hiveAssetId], 'function');
  assert.equal(typeof GARDEN_ASSETS[GARDEN_DRESSING.flowerAssetId], 'function');
  assert.deepEqual(BEEHIVE_FOOTPRINT, { halfWidth: 0.35, halfDepth: 0.35 });
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

test('sheep and shelter appearance slots do not change their geometry or footprint data', () => {
  const sheep = createSheep(1, 0).group;
  const changedSheep = createSheep(1, 0, { ...ART_SLOTS.palette.sheep, woolShade: 0x123456, brown: 0x334455 }).group;
  assert.equal(changedSheep.getObjectByName('sheep-2-wool-1').material.color.getHex(), 0x123456);
  assert.equal(changedSheep.getObjectByName('sheep-2-face').material.color.getHex(), 0x334455);
  assert.deepEqual(new THREE.Box3().setFromObject(changedSheep), new THREE.Box3().setFromObject(sheep));

  const shelter = createLeanTo();
  const changedShelter = createLeanTo({ ...ART_SLOTS.building.sheepfold, wall: 0x223344, roof: 0x445566 });
  assert.equal(changedShelter.getObjectByName('sheepfold-back-wall').material.color.getHex(), 0x223344);
  assert.equal(changedShelter.getObjectByName('sheepfold-roof').material.color.getHex(), 0x445566);
  assert.deepEqual(new THREE.Box3().setFromObject(changedShelter), new THREE.Box3().setFromObject(shelter));
  assert.deepEqual([SHEEPFOLD.width, SHEEPFOLD.depth, SHEEPFOLD.sheepRadius, LEAN_TO.width, LEAN_TO.depth],
    [4.5, 3, 0.4, 1.4, 1.2]);
});

test('effect appearance slots change colors and opacity without changing seeded motion or dimensions', () => {
  const camera = new THREE.PerspectiveCamera();
  const baseline = new THREE.Scene();
  const changed = new THREE.Scene();
  const smokeSlots = { ...ART_SLOTS.palette.smoke, ...ART_SLOTS.prop.smoke, color: 0x123456, peakOpacity: 0.5 };
  const flySlots = { ...ART_SLOTS.palette.firefly, ...ART_SLOTS.prop.firefly, core: 0x234567, pulseFloor: 0.1 };
  for (const scene of [baseline, changed]) {
    const chimney = new THREE.Group();
    chimney.name = 'cottage-chimney-top';
    scene.add(chimney);
  }
  const smoke = createChimneySmoke({ scene: baseline });
  const otherSmoke = createChimneySmoke({ scene: changed, slots: smokeSlots });
  const flies = createFireflies({ scene: baseline, camera, groundHeight: 2.4 });
  const otherFlies = createFireflies({ scene: changed, camera, groundHeight: 2.4, slots: flySlots });
  smoke.update(1, 0, 0);
  otherSmoke.update(1, 0, 0);
  flies.update(1, 1, 0, 0);
  otherFlies.update(1, 1, 0, 0);
  const puff = baseline.getObjectByName('chimney-smoke-1');
  const otherPuff = changed.getObjectByName('chimney-smoke-1');
  assert.equal(otherPuff.material.color.getHex(), 0x123456);
  assert.notEqual(otherPuff.material.opacity, puff.material.opacity);
  assert.deepEqual(otherPuff.position.toArray(), puff.position.toArray());
  assert.deepEqual(otherPuff.scale.toArray(), puff.scale.toArray());
  const swarm = baseline.getObjectByName('night-fireflies');
  const otherSwarm = changed.getObjectByName('night-fireflies');
  assert.equal(otherSwarm.material.uniforms.coreColor.value.getHex(), 0x234567);
  assert.notDeepEqual([...otherSwarm.geometry.getAttribute('instanceOpacity').array], [...swarm.geometry.getAttribute('instanceOpacity').array]);
  assert.deepEqual([...otherSwarm.instanceMatrix.array], [...swarm.instanceMatrix.array]);
  assert.deepEqual(otherSwarm.geometry.parameters, swarm.geometry.parameters);
  smoke.dispose(); otherSmoke.dispose(); flies.dispose(); otherFlies.dispose();
});
