import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

// Make a shareable example from the real ECS systems, not a handwritten save.
const path = process.argv[2];
if (!path) throw new Error('Usage: node tools/write-snapshot-example.mjs <output.json>');
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
  const { ISLAND } = await vite.ssrLoadModule('/src/content/world.ts');
  const { PLAYER_GEOMETRY } = await vite.ssrLoadModule('/src/content/playerGeometry.ts');
  const { createDayNightState, setPhase } = await vite.ssrLoadModule('/src/environment/dayNightSystem.ts');
  const { createWeatherState, setWeatherMode, advanceWeather } = await vite.ssrLoadModule('/src/environment/weatherSystem.ts');
  const { createPlacementSystem } = await vite.ssrLoadModule('/src/placement/placementSystem.ts');
  const { snapshot } = await vite.ssrLoadModule('/src/state/snapshot.ts');
  const world = createEntityWorld();
  const halfSize = ISLAND.size / 2;
  world.create({
    transform: { position: [0, ISLAND.groundHeight, 0], yaw: 0 },
    character: { radius: PLAYER_GEOMETRY.radius, groundHeight: ISLAND.groundHeight,
      bounds: { minX: -halfSize, maxX: halfSize, minZ: -halfSize, maxZ: halfSize }, target: null, floorHeight: ISLAND.groundHeight },
  });
  const clock = createDayNightState();
  setPhase(clock, 'daytime');
  clock.held = true;
  const weather = createWeatherState();
  setWeatherMode(weather, 'rain');
  advanceWeather(weather, 0.875);
  world.create({ dayNight: clock, weather });
  const placement = createPlacementSystem(world, ISLAND.size, ISLAND.groundHeight);
  const hit = { x: 3.75, z: 3.75 };
  placement.dispatch({ type: 'placement-select', kind: 'fence' }, null);
  placement.dispatch({ type: 'placement-preview', point: { x: 100, y: 100, pointerType: 'mouse' } }, hit);
  placement.dispatch({ type: 'placement-rotate' }, hit);
  placement.dispatch({ type: 'placement-confirm' }, hit);
  const data = snapshot(world);
  assert.equal(data.placed.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote ${path}`);
} finally { await vite.close(); }
