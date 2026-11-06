import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
const { createPlacementSystem } = await vite.ssrLoadModule('/src/placement/placementSystem.ts');
after(() => vite.close());

function fixture() {
  const world = createEntityWorld();
  const player = world.create({ transform: { position: [0, 2.4, 0], yaw: 0 }, character: { radius: 0.4 } });
  const system = createPlacementSystem(world, 16, 2.4);
  const action = (type, extra = {}, hit = null) => system.dispatch({ type, ...extra }, hit);
  const preview = (x, z, pointerType = 'mouse') =>
    action('placement-preview', { point: { x: 100, y: 100, pointerType } }, { x, z });
  return { world, player, system, action, preview };
}

test('preview state and placed fence/plot entities contain plain data and own their collisions', () => {
  const { world, system, action, preview } = fixture();
  action('placement-select', { kind: 'fence' });
  preview(3.75, 3.75);
  assert.equal(system.state.message, 'Fence · Ready to place');
  action('placement-rotate', {}, { x: 3.75, z: 3.75 });
  assert.equal(system.state.rotation, 1);
  action('placement-confirm', {}, { x: 3.75, z: 3.75 });
  const [fence] = [...world.with('placed')];
  assert.equal(fence.placed.kind, 'fence');
  assert.deepEqual(fence.transform, { position: [3.75, 2.4, 3.75], yaw: Math.PI / 2 });
  assert.equal(fence.obstacle.name, 'placed-fence-1');
  assert.equal([...world.with('obstacle')].length, 1);
  assert.equal(system.state.message, 'Fence · Space already occupied');

  action('placement-select', { kind: 'plot' }, { x: -3.75, z: -0.75 });
  preview(-3.75, -0.75, 'touch');
  assert.equal([...world.with('placed')].length, 1, 'touch preview alone must not place');
  action('placement-confirm', {}, { x: -3.75, z: -0.75 });
  const plot = [...world.with('placed')].find((item) => item.placed.kind === 'plot');
  assert.equal(plot.placed.cells.length, 2);
  assert.equal(plot.obstacle, undefined, 'plots are walkable');
  assert.equal([...world.with('obstacle')].length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify([system.state, fence, plot])), [system.state, fence, plot]);
  action('placement-cancel');
  assert.equal(system.state.kind, null);
  assert.equal([...world.with('placed')].length, 2, 'cancel retains placed items');
  action('placement-undo');
  assert.deepEqual([...world.with('placed')].map((item) => item.placed.kind), ['fence']);
  action('placement-undo');
  assert.equal([...world.with('obstacle')].length, 0);
});

test('validation uses player, obstacle and decorative keep-out entities and rechecks on confirm', () => {
  const { world, player, system, action, preview } = fixture();
  action('placement-select', { kind: 'fence' });
  preview(0.75, 0.75);
  assert.match(system.state.message, /Move away/);
  for (const name of ['cottage', 'coop', 'water', 'wooden-bridge']) {
    const obstacle = world.create({ obstacle: { kind: 'box', name, minX: 3, maxX: 4.5, minZ: 3, maxZ: 4.5,
      ...(name === 'wooden-bridge' ? { blocksWalking: false } : {}) } });
    preview(3.75, 3.75);
    assert.match(system.state.message, /Blocked by a farm object/, name);
    world.remove(obstacle);
  }
  const decoration = world.create({ placementBlocker: { kind: 'circle', name: 'decoration', x: 3.75, z: 3.75, radius: 0.2 } });
  preview(3.75, 3.75);
  assert.match(system.state.message, /Blocked by a farm object/);
  world.remove(decoration);
  preview(3.75, 3.75);
  assert.equal(system.state.valid, true);
  player.transform.position[0] = 3.75;
  player.transform.position[2] = 3.75;
  action('placement-confirm', {}, { x: 3.75, z: 3.75 });
  assert.match(system.state.message, /Move away/);
  assert.equal([...world.with('placed')].length, 0);
  preview(8.1, 0.75);
  assert.match(system.state.message, /Outside the buildable island/);
  action('placement-preview', { point: { x: 10, y: 10, pointerType: 'mouse' } }, null);
  assert.equal(system.state.area, null, 'a missed ground ray, including the stairs, cannot place');
});

test('targeted removal and undo respect placement order even after Miniplex swap-removes an older entity', () => {
  const { world, action, preview } = fixture();
  function place(kind, x, z) {
    action('placement-select', { kind });
    preview(x, z);
    action('placement-confirm', {}, { x, z });
  }
  place('fence', -5.25, -5.25);
  place('plot', -5.25, -2.25);
  place('fence', 5.25, 5.25);
  assert.equal([...world.with('placed')].length, 3);
  preview(-5.25, -5.25);
  action('placement-remove', { mode: 'hovered' }, { x: -5.25, z: -5.25 });
  action('placement-undo');
  const remaining = [...world.with('placed')];
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].placed.kind, 'plot');
  assert.equal([...world.with('obstacle')].length, 0);
});
