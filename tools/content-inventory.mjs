import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Print every content leaf key; [] represents array elements, not a value or
// an arbitrary choice of one instance. Used for the EBR-76 delivery inventory.
const modules = {
  slots: ['ART_SLOTS'],
  farm: ['FARM_CONTENT_ID', 'FARM_LAYOUT', 'FARM_DECORATIONS'],
  buildings: ['FARM_BUILDINGS'],
  world: ['ISLAND', 'STAIR', 'GRID'],
  propGeometry: ['PATH_GEOMETRY', 'TREE_GEOMETRY', 'POND_GEOMETRY', 'GRASS_GEOMETRY'],
  decorationGeometry: ['CHICKEN_GEOMETRY', 'NEST_GEOMETRY', 'DECORATION_GEOMETRY'],
  buildingGeometry: ['COTTAGE_GEOMETRY', 'COOP_GEOMETRY', 'GABLE_GEOMETRY'],
  playerGeometry: ['PLAYER_GEOMETRY'],
  placementGeometry: ['PLACEMENT_GEOMETRY'],
  lightGeometry: ['KEY_LIGHT_GEOMETRY', 'PRACTICAL_LIGHT_GEOMETRY', 'FARM_SHADOW_GEOMETRY'],
  camera: ['CAMERA'],
  waterFeature: ['WATER_FEATURE'],
  dayNight: ['DAY_NIGHT_PHASES', 'DEFAULT_DAY_NIGHT_CYCLE_SECONDS', 'WINDOW_LIGHT', 'LANTERN_LIGHT'],
  rainSettings: ['RAIN_LOOK'],
  cloudySettings: ['CLOUDY_LOOK'],
  weatherVisual: ['RAIN_INITIAL_OPACITY'],
  presentation: ['PIXEL_PRESENTATION'],
  sheep: ['DEFAULT_SHEEP_SEED', 'SHEEPFOLD', 'LEAN_TO', 'SHEEPFOLD_GEOMETRY', 'LEAN_TO_GEOMETRY', 'SHEEP_GEOMETRY'],
  effects: ['FIREFLIES', 'CHIMNEY_SMOKE'],
  startup: ['STARTUP_OPTIONS', 'VISUAL_SEEDS'],
};

function paths(value, path, result) {
  if (Array.isArray(value)) {
    if (!value.length) result.add(`${path}[]`);
    for (const item of value) paths(item, `${path}[]`, result);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) paths(child, `${path}.${key}`, result);
  } else result.add(path);
}

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  for (const [file, exports] of Object.entries(modules)) {
    const data = await vite.ssrLoadModule(`/src/content/${file}.ts`);
    const result = new Set();
    for (const key of exports) {
      assert.notEqual(data[key], undefined, `Missing content export: ${file}.${key}`);
      paths(data[key], key, result);
    }
    console.log(`src/content/${file}.ts`);
    for (const path of [...result].sort()) console.log(`  ${path}`);
  }
} finally { await vite.close(); }
