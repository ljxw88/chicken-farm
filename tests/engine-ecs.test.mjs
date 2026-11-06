import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { World } from 'miniplex';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
after(() => vite.close());

test('project IDs are stable, distinct, immutable, and not recycled', () => {
  const world = createEntityWorld();
  const first = world.create({ assetId: 'cottage' });
  const restored = world.create({ transform: { position: [1, 2, 3], yaw: 0 } }, 'entity-2');
  const third = world.create({});
  assert.deepEqual([first.id, restored.id, third.id], ['entity-1', 'entity-2', 'entity-3']);
  assert.equal(world.get(restored.id), restored);
  assert.throws(() => { first.id = 'changed'; }, TypeError);
  assert.throws(() => world.create({}, first.id), /already used/);
  assert.equal(world.remove(first), true);
  assert.equal(world.remove(first), false);
  assert.equal(world.get(first.id), undefined);
  assert.throws(() => world.create({}, first.id), /already used/);
  assert.equal(world.create({}).id, 'entity-4');

  // A fresh world can restore an ID from plain saved data, without Miniplex IDs.
  const saved = JSON.parse(JSON.stringify(restored));
  const { id, ...components } = saved;
  const other = createEntityWorld();
  assert.deepEqual(JSON.parse(JSON.stringify(other.create(components, id))), saved);
  assert.equal(other.get(id).id, restored.id);
  assert.throws(() => other.create({ id: 'forged' }), /owned by the world/);
  assert.throws(() => other.create({}, ''), /non-empty/);
});

test('Miniplex live queries follow component membership and removal', () => {
  const world = createEntityWorld();
  const moving = world.with('transform', 'velocity');
  assert.ok(moving.world instanceof World);
  const events = [];
  moving.onEntityAdded.subscribe((entity) => events.push(`+${entity.id}`));
  moving.onEntityRemoved.subscribe((entity) => events.push(`-${entity.id}`));
  const a = world.create({ transform: { position: [0, 0, 0], yaw: 0 } });
  const b = world.create({ transform: { position: [1, 0, 0], yaw: 0 }, velocity: { x: 1, z: 0 } });
  assert.deepEqual([...moving].map((entity) => entity.id), [b.id]);
  world.addComponent(a, 'velocity', { x: 0, z: 1 });
  assert.deepEqual(new Set([...moving].map((entity) => entity.id)), new Set([a.id, b.id]));
  world.removeComponent(b, 'velocity');
  assert.deepEqual([...moving].map((entity) => entity.id), [a.id]);
  assert.deepEqual([...world.without('velocity')].map((entity) => entity.id), [b.id]);
  world.remove(a);
  assert.equal([...moving].length, 0);
  assert.deepEqual(events, [`+${b.id}`, `+${a.id}`, `-${b.id}`, `-${a.id}`]);
  assert.throws(() => world.addComponent(a, 'velocity', { x: 1 }), /not in this world/);
  assert.throws(() => world.removeComponent(b, 'id'), /cannot be changed/);
});

test('entities and component additions accept only plain finite data', () => {
  const world = createEntityWorld();
  const entity = world.create({ assetId: 'tree', transform: { position: [1, 2, 3], yaw: 0 } });
  assert.deepEqual(JSON.parse(JSON.stringify(entity)), {
    assetId: 'tree', transform: { position: [1, 2, 3], yaw: 0 }, id: 'entity-1',
  });
  assert.throws(() => world.create({ transform: new THREE.Vector3() }), /class instances/);
  assert.throws(() => world.addComponent(entity, 'foo', () => {}), /plain/);
  assert.throws(() => world.addComponent(entity, 'foo', Infinity), /plain/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => world.addComponent(entity, 'foo', cycle), /cycles/);
});
