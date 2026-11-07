import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
const { createPlacementSystem } = await vite.ssrLoadModule('/src/placement/placementSystem.ts');
const { createDayNightState } = await vite.ssrLoadModule('/src/environment/dayNightSystem.ts');
const { createWeatherState, setWeatherMode, advanceWeather } = await vite.ssrLoadModule('/src/environment/weatherSystem.ts');
const { snapshot } = await vite.ssrLoadModule('/src/state/snapshot.ts');
after(() => vite.close());

function fixture() {
  const world = createEntityWorld();
  const player = world.create({
    transform: { position: [0, 2.4, 0], yaw: 0 },
    character: { radius: 0.4, groundHeight: 2.4, bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
      target: null, floorHeight: 2.4 },
  }, 'player-stable');
  const environment = world.create({ dayNight: createDayNightState(), weather: createWeatherState() });
  environment.dayNight.progress = 0.375;
  environment.dayNight.cycleSeconds = 96;
  environment.dayNight.held = true;
  setWeatherMode(environment.weather, 'rain');
  advanceWeather(environment.weather, 0.875);
  const placement = createPlacementSystem(world, 16, 2.4);
  function place(kind, x, z, rotate = false) {
    placement.dispatch({ type: 'placement-select', kind }, null);
    placement.dispatch({ type: 'placement-preview', point: { x: 100, y: 100, pointerType: 'mouse' } }, { x, z });
    if (rotate) placement.dispatch({ type: 'placement-rotate' }, { x, z });
    placement.dispatch({ type: 'placement-confirm' }, { x, z });
    assert.equal([...world.with('placed')].length > 0, true);
    return [...world.with('placed')].reduce((last, item) => item.placed.sequence > (last?.placed.sequence ?? 0) ? item : last, null);
  }
  return { world, player, environment, place };
}

function assertJsonData(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return; }
  assert.equal(typeof value, 'object');
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
  assert.deepEqual(Object.getOwnPropertySymbols(value), []);
  for (const child of Object.values(value)) assertJsonData(child);
}

test('snapshot describes stable player, placed cells, clock and weather as detached JSON data', () => {
  const { world, player, environment, place } = fixture();
  const fence = place('fence', 3.75, 3.75, true);
  const plot = place('plot', -3.75, -0.75);
  const actual = snapshot(world);
  assert.deepEqual(actual, {
    version: 1, contentId: 'farm-v1', player: { position: [0, 2.4, 0], yaw: 0 },
    placed: [
      { id: fence.id, kind: 'fence', cell: [7, 7], rotation: 1 },
      { id: plot.id, kind: 'plot', cell: [2, 4], rotation: 0 },
    ],
    clock: { progress: 0.375, cycleSeconds: 96, held: true },
    weather: { mode: 'rain', rainProgress: 0.5, cloudyProgress: 0, snowProgress: 0 },
  });
  assertJsonData(actual);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), actual);
  assert.deepEqual(snapshot(world), actual, 'stable IDs and order survive repeated descriptions');
  actual.player.position[0] = 123;
  actual.placed[0].cell[0] = 123;
  actual.clock.held = false;
  assert.equal(player.transform.position[0], 0);
  assert.equal(fence.placed.area.cell.column, 7);
  assert.equal(environment.dayNight.held, true);
  player.transform.position[0] = -0;
  player.transform.yaw = -0;
  const canonical = snapshot(world, 'custom-content');
  assert.equal(Object.is(canonical.player.position[0], 0), true);
  assert.equal(Object.is(canonical.player.yaw, 0), true);
  assert.deepEqual(JSON.parse(JSON.stringify(canonical)), canonical);
  assert.equal(canonical.contentId, 'custom-content');
});

test('snapshot preserves a partially crossfaded snow transition as detached JSON data', () => {
  const { world, environment } = fixture();
  setWeatherMode(environment.weather, 'snow');
  advanceWeather(environment.weather, 0.4375);
  const saved = snapshot(world);
  assert.deepEqual(saved.weather, { mode: 'snow', rainProgress: 0.25, cloudyProgress: 0, snowProgress: 0.25 });
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved);
  saved.weather.snowProgress = 1;
  assert.equal(environment.weather.snowProgress, 0.25);
  environment.weather.snowProgress = NaN;
  assert.throws(() => snapshot(world), /snowProgress must be finite/);
});

test('snapshot preserves placement sequence after Miniplex swap-removal', () => {
  const { world, place } = fixture();
  const first = place('fence', -5.25, -5.25);
  const second = place('plot', -5.25, -2.25);
  const third = place('fence', 5.25, 5.25);
  world.remove(first);
  assert.deepEqual(snapshot(world).placed.map(({ id }) => id), [second.id, third.id]);
});

test('snapshot rejects invalid or ambiguous live values rather than emitting non-JSON data', () => {
  const { world, player, environment, place } = fixture();
  const item = place('fence', 3.75, 3.75);
  for (const invalid of [NaN, Infinity, -Infinity, undefined, () => 0, new THREE.Vector3()]) {
    player.transform.position[0] = invalid;
    assert.throws(() => snapshot(world), /player.x must be finite/);
  }
  player.transform.position[0] = 0;
  environment.weather.mode = 'storm';
  assert.throws(() => snapshot(world), /Unknown weather/);
  environment.weather.mode = 'rain';
  environment.weather.rainProgress = NaN;
  assert.throws(() => snapshot(world), /rainProgress must be finite/);
  environment.weather.rainProgress = 0.5;
  environment.dayNight.cycleSeconds = 0;
  assert.throws(() => snapshot(world), /cycleSeconds must be positive/);
  environment.dayNight.cycleSeconds = 96;
  item.placed.rotation = 4;
  assert.throws(() => snapshot(world), /quarter turn/);
  item.placed.rotation = 0;
  assert.throws(() => snapshot(world, ''), /contentId/);
  world.create({ dayNight: createDayNightState() });
  assert.throws(() => snapshot(world), /exactly one clock/);
});
