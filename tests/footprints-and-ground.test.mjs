import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { PLACEABLES, rectangleDimensions, validatePlaceables } = await vite.ssrLoadModule('/src/content/placeables.ts');
const { GROUND } = await vite.ssrLoadModule('/src/content/ground.ts');
const { GRID } = await vite.ssrLoadModule('/src/content/world.ts');
const { rotatedCells } = await vite.ssrLoadModule('/src/placement/footprints.ts');
const { createGroundGrid } = await vite.ssrLoadModule('/src/world/ground.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createFarmTerrain } = await vite.ssrLoadModule('/src/app/farmTerrain.ts');
after(() => vite.close());

// This shape is test data only; it is not a runtime asset or toolbar entry.
const lShape = {
  id: 'example.l', assetId: 'example.l', size: [3, 1, 3], footprint: [[0, 0], [0, 1], [1, 1]],
  anchor: [0, 0], visualOffset: [0, 0, 0], blocking: 'solid', blocksPlacement: true, collider: { type: 'cells' },
};
const cell = (column, row) => ({ column, row });

test('fence and plot are finite plain content with their existing sizes, reservation and collision rules', () => {
  assert.deepEqual(Object.keys(PLACEABLES), ['fence', 'plot']);
  assert.deepEqual(JSON.parse(JSON.stringify({ PLACEABLES, GROUND })), { PLACEABLES, GROUND });
  validatePlaceables({ ...PLACEABLES, 'example.l': lShape });
  assert.deepEqual(PLACEABLES.fence.size, [1.47, 0.95, 0.215]);
  assert.deepEqual(PLACEABLES.fence.collider, { type: 'box', width: 1.47, depth: 0.26 });
  assert.deepEqual([PLACEABLES.fence.blocking, PLACEABLES.plot.blocking], ['solid', 'walkable']);
  assert.deepEqual([PLACEABLES.fence.blocksPlacement, PLACEABLES.plot.blocksPlacement], [true, true]);
  assert.deepEqual(PLACEABLES.plot.size, [2.94, 0.31, 1.44]);
  assert.deepEqual(GRID.footprints, { fence: { columns: 1, rows: 1 }, plot: { columns: 2, rows: 1 } });
  assert.deepEqual(GRID.fenceCollision, { halfLength: 0.735, halfWidth: 0.13 });
  assert.throws(() => rectangleDimensions(lShape), /not a rectangle/);
});

test('rotation keeps the selected reference and produces exactly the expected rectangle and L cells', () => {
  const anchor = cell(2, 4);
  for (const turn of [0, 1, 2, 3, 4, -1]) {
    assert.deepEqual(rotatedCells(PLACEABLES.fence, anchor, turn), [cell(2, 4)]);
    assert.deepEqual(rotatedCells(PLACEABLES.plot, anchor, turn), turn % 2 ? [cell(2, 4), cell(2, 5)] : [cell(2, 4), cell(3, 4)]);
  }
  const expected = [
    [cell(2, 4), cell(2, 5), cell(3, 5)],
    [cell(2, 5), cell(3, 4), cell(3, 5)],
    [cell(2, 4), cell(3, 4), cell(3, 5)],
    [cell(2, 4), cell(2, 5), cell(3, 4)],
  ];
  for (let turn = 0; turn < 4; turn++) assert.deepEqual(rotatedCells(lShape, anchor, turn), expected[turn]);
  assert.deepEqual(rotatedCells(lShape, anchor, 4), expected[0]);
  const offCenter = { ...lShape, footprint: [[-1, 0], [0, 0]], anchor: [1, 0] };
  validatePlaceables({ 'example.l': offCenter });
  assert.deepEqual(rotatedCells(offCenter, anchor, 0), [cell(1, 4), cell(2, 4)]);
  assert.deepEqual(rotatedCells(offCenter, anchor, 1), [cell(1, 4), cell(1, 5)]);
  assert.throws(() => rotatedCells(lShape, anchor, 0.5), /safe integers/);
  assert.throws(() => rotatedCells(lShape, cell(Number.MAX_SAFE_INTEGER, 0), 0), /out of range/);
});

test('malformed placeable metadata is rejected rather than silently reshaping assets', () => {
  const invalid = (changes) => ({ fence: { ...structuredClone(PLACEABLES.fence), ...changes } });
  for (const [input, reason] of [
    [{}, /non-empty registry/],
    [invalid({ id: '' }), /id/],
    [invalid({ id: 'other' }), /key does not match/],
    [invalid({ assetId: '' }), /asset id/],
    [invalid({ size: [1, 0, 1] }), /visual size/],
    [invalid({ visualOffset: [0, NaN, 0] }), /offset/],
    [invalid({ anchor: [0.5, 0] }), /anchor/],
    [invalid({ footprint: [] }), /Empty footprint/],
    [invalid({ footprint: [[0, 0], [0, 0]] }), /Duplicate footprint/],
    [invalid({ footprint: [[0, Infinity]] }), /footprint cell/],
    [invalid({ footprint: [Array(2)] }), /footprint cell/],
    [invalid({ anchor: [1, 0] }), /footprint minimum/],
    [invalid({ blocksPlacement: 'yes' }), /blocking or collider/],
    [invalid({ blocking: { toString: () => 'solid' } }), /blocking or collider/],
    [invalid({ blocking: 'walkable' }), /does not match/],
    [invalid({ collider: { type: 'box', width: 0, depth: 1 } }), /box collider/],
    [{ fence: PLACEABLES.fence, duplicate: { ...PLACEABLES.fence } }, /Duplicate placeable id/],
  ]) assert.throws(() => validatePlaceables(input), reason);
});

test('island-0 preserves world edges, full-tile coordinates and separate land/support bounds', () => {
  const grid = createGroundGrid(undefined, { minX: -8, maxX: 13.55, minZ: -8, maxZ: 8 });
  assert.deepEqual(grid.chunkIds(), ['island-0']);
  assert.deepEqual(grid.origin, [-7.5, -7.5]);
  assert.equal(grid.cells().length, 100);
  assert.deepEqual(grid.cellAt(-7.5, -7.5), cell(0, 0));
  assert.deepEqual(grid.cellAt(-7.5001, -7.5), cell(-1, 0));
  assert.deepEqual(grid.cellAt(-0.01, 0.01), cell(4, 5));
  assert.deepEqual(grid.cellAt(7.4999, 7.4999), cell(9, 9));
  assert.deepEqual(grid.cellAt(7.5, -7.8), cell(10, -1));
  assert.deepEqual(grid.cellBounds(cell(0, 0)), { minX: -7.5, maxX: -6, minZ: -7.5, maxZ: -6 });
  assert.equal(grid.getCell(cell(9, 9)).state, 'free');
  assert.equal(grid.getCell(cell(10, 0)).state, 'void');
  assert.deepEqual(grid.bounds(), {
    land: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
    support: { minX: -8, maxX: 13.55, minZ: -8, maxZ: 8 },
  });
  assert.throws(() => grid.cellAt(Infinity, 0), /finite/);
  assert.throws(() => grid.getCell(cell(0.1, 0)), /safe integers/);
});

test('an L reserves only its rotated cells; overlapping owners and non-blocking owners remain independent', () => {
  for (let turn = 0; turn < 4; turn++) {
    const grid = createGroundGrid();
    const occupied = rotatedCells(lShape, cell(2, 4), turn);
    grid.setOccupant({ id: 'l', kind: 'blocker', blocksPlacement: true, cells: occupied });
    const expected = new Set(occupied.map(({ column, row }) => `${column},${row}`));
    for (let column = 2; column <= 3; column++) for (let row = 4; row <= 5; row++) {
      assert.equal(grid.getCell(cell(column, row)).state, expected.has(`${column},${row}`) ? 'blocked' : 'free');
    }
    const shared = occupied[0];
    grid.setOccupant({ id: 'tree', kind: 'blocker', blocksPlacement: true, cells: [shared] });
    grid.setOccupant({ id: 'decoration', kind: 'blocker', blocksPlacement: false, cells: [cell(0, 0)] });
    assert.equal(grid.getCell(cell(0, 0)).state, 'free');
    assert.deepEqual(new Set(grid.getCell(shared).owners), new Set(['l', 'tree']));
    assert.equal(grid.removeOccupant('l'), true);
    assert.equal(grid.getCell(shared).state, 'blocked');
    assert.deepEqual(grid.getCell(shared).owners, ['tree']);
    for (const other of occupied.slice(1)) assert.equal(grid.getCell(other).state, 'free');
    assert.equal(grid.removeOccupant('tree'), true);
    assert.equal(grid.getCell(shared).state, 'free');
    assert.equal(grid.removeOccupant('missing'), false);
  }
});

test('cell state combines terrain overlays, occupants and their independent blocking rules', () => {
  const grid = createGroundGrid();
  const target = cell(0, 0);
  grid.setOccupant({ id: 'path', kind: 'path', blocksPlacement: false, cells: [target] });
  assert.deepEqual([grid.getCell(target).base, grid.getCell(target).terrain, grid.getCell(target).state], ['free', 'path', 'path']);
  grid.setOccupant({ id: 'water', kind: 'water', blocksPlacement: true, cells: [target] });
  assert.deepEqual([grid.getCell(target).terrain, grid.getCell(target).state], ['water', 'water']);
  grid.setOccupant({ id: 'plot', kind: 'plot', blocksPlacement: true, cells: [target] });
  assert.deepEqual([grid.getCell(target).terrain, grid.getCell(target).state], ['water', 'plot']);
  grid.setOccupant({ id: 'bridge', kind: 'blocker', blocksPlacement: true, cells: [target] });
  assert.equal(grid.getCell(target).state, 'blocked');
  grid.removeOccupant('bridge');
  assert.equal(grid.getCell(target).state, 'plot');
  grid.removeOccupant('plot');
  assert.equal(grid.getCell(target).state, 'water');
  grid.removeOccupant('water');
  assert.equal(grid.getCell(target).state, 'path');
  grid.removeOccupant('path');
  assert.equal(grid.getCell(target).state, 'free');
  grid.addChunk({ id: 'locked', land: [{ min: [-9, -7.5], max: [-8, -6], height: 2.4 }],
    cells: [{ min: [-1, 0], maxExclusive: [0, 1], terrain: 'locked' }] });
  grid.setOccupant({ id: 'locked-blocker', kind: 'blocker', blocksPlacement: true, cells: [cell(-1, 0), cell(-2, 0)] });
  assert.equal(grid.getCell(cell(-1, 0)).state, 'locked');
  assert.equal(grid.getCell(cell(-2, 0)).state, 'void');
});

test('extension covers the old edge strip, adds cells without moving existing ones, and notifies once', () => {
  const grid = createGroundGrid();
  const events = [];
  const unsubscribe = grid.onChange((event) => events.push(event));
  const original = grid.cellBounds(cell(9, 0));
  grid.addChunk({ id: 'east', land: [
    { min: [8, -7.5], max: [8.5, -6], height: 2.4 },
    { min: [8.5, -7.5], max: [9, -6], height: 2.4 },
  ], cells: [{ min: [10, 0], maxExclusive: [11, 1], terrain: 'free' }] });
  assert.deepEqual(grid.cellBounds(cell(9, 0)), original);
  assert.deepEqual(grid.cellAt(8.25, -6.75), cell(10, 0));
  assert.equal(grid.getCell(cell(10, 0)).state, 'free');
  assert.equal(grid.cells().length, 101);
  assert.deepEqual(grid.chunkIds(), ['island-0', 'east']);
  assert.deepEqual(grid.bounds().land, { minX: -8, maxX: 9, minZ: -8, maxZ: 8 });
  assert.deepEqual(events, [{ type: 'chunk-added', id: 'east', cells: [cell(10, 0)] }]);
  unsubscribe();
  grid.setOccupant({ id: 'added', kind: 'blocker', blocksPlacement: true, cells: [cell(10, 0)] });
  assert.equal(events.length, 1);
});

test('invalid chunks and occupants fail atomically without changing cells, bounds or notifications', () => {
  const grid = createGroundGrid();
  const events = [];
  grid.onChange((event) => events.push(event));
  const baseline = grid.bounds();
  const range = { min: [10, 0], maxExclusive: [11, 1], terrain: 'free' };
  assert.throws(() => grid.addChunk({ id: 'gap', land: [{ min: [8.00000001, -7.5], max: [9, -6], height: 2.4 }], cells: [range] }), /not fully supported/);
  assert.throws(() => grid.addChunk({ id: 'height', land: [{ min: [8, -7.5], max: [9, -6], height: 3 }], cells: [range] }), /not fully supported/);
  assert.throws(() => grid.addChunk({ id: 'island-0', land: [], cells: [] }), /Duplicate ground chunk/);
  assert.throws(() => grid.addChunk({ id: 'duplicate', land: [], cells: [{ min: [0, 0], maxExclusive: [1, 1], terrain: 'free' }] }), /Duplicate ground cell/);
  assert.throws(() => grid.addChunk({ id: 'invalid', land: [], cells: [{ min: [1.5, 0], maxExclusive: [2, 1], terrain: 'free' }] }), /cell range/);
  assert.throws(() => grid.setOccupant({ id: 'bad', kind: 'blocker', blocksPlacement: true, cells: [cell(0, 0), cell(0, 0)] }), /Duplicate occupant/);
  assert.throws(() => grid.setOccupant({ id: 'bad', kind: 'water', blocksPlacement: false, cells: [cell(0, 0)] }), /inconsistent/);
  assert.deepEqual(grid.chunkIds(), ['island-0']);
  assert.deepEqual(grid.bounds(), baseline);
  assert.equal(grid.getCell(cell(10, 0)).state, 'void');
  assert.equal(grid.getCell(cell(0, 0)).state, 'free');
  assert.deepEqual(events, []);
});

test('moving an indexed owner replaces its cells and emits one change without losing overlapping owners', () => {
  const grid = createGroundGrid();
  const events = [];
  grid.onChange((event) => events.push(event));
  grid.setOccupant({ id: 'moving', kind: 'blocker', blocksPlacement: true, cells: [cell(0, 0)] });
  grid.setOccupant({ id: 'static', kind: 'blocker', blocksPlacement: true, cells: [cell(0, 0)] });
  grid.setOccupant({ id: 'moving', kind: 'blocker', blocksPlacement: true, cells: [cell(1, 0)] });
  assert.deepEqual(grid.getCell(cell(0, 0)).owners, ['static']);
  assert.deepEqual(grid.getCell(cell(1, 0)).owners, ['moving']);
  assert.deepEqual(events.at(-1), { type: 'occupant-set', id: 'moving', cells: [cell(0, 0), cell(1, 0)] });
  const count = events.length;
  grid.setOccupant({ id: 'moving', kind: 'blocker', blocksPlacement: true, cells: [cell(1, 0)] });
  assert.equal(events.length, count, 'an unchanged source does not notify');
  const copy = grid.getOccupant('moving');
  copy.cells[0].column = 9;
  assert.deepEqual(grid.getCell(cell(1, 0)).owners, ['moving']);
});

test('farm path and water cell labels follow the existing ribbon and placement keep-outs', () => {
  const grid = createGroundGrid();
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene);
  const terrain = createFarmTerrain(grid, scene, () => obstacles);
  assert.equal(grid.getCell(grid.cellAt(0, 0)).terrain, 'path');
  assert.equal(grid.getCell(grid.cellAt(4, -3.5)).terrain, 'water');
  const water = obstacles.filter(({ name }) => name === 'pond' || name.startsWith('stream-water-'));
  for (const tile of grid.cells()) {
    const area = grid.cellBounds(tile);
    const touches = water.some((box) => area.minX < box.maxX && area.maxX > box.minX &&
      area.minZ < box.maxZ && area.maxZ > box.minZ);
    assert.equal(grid.getCell(tile).terrain === 'water', touches, `${tile.column},${tile.row}`);
  }
  const pond = obstacles.findIndex(({ name }) => name === 'pond');
  obstacles.splice(pond, 1);
  terrain.refresh();
  assert.equal(grid.getCell(grid.cellAt(4.5, -4.5)).terrain, 'free');
  assert.equal(grid.getCell(cell(10, 5)).state, 'void');
  grid.addChunk({ id: 'path-extension', land: [{ min: [8, 0], max: [9, 1.5], height: 2.4 }],
    cells: [{ min: [10, 5], maxExclusive: [11, 6], terrain: 'free' }] });
  assert.equal(grid.getCell(cell(10, 5)).terrain, 'path', 'existing path is reclassified over new cells');
  terrain.dispose();
});
