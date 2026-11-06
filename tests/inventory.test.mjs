import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createInventory } = await vite.ssrLoadModule('/src/inventory/createInventory.ts');
after(() => vite.close());

test('pickup and consume hooks use session-only Feed and Egg stacks', () => {
  const inventory = createInventory();
  const snapshots = [];
  const unsubscribe = inventory.subscribe((counts) => snapshots.push(counts));
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
  assert.equal(inventory.consume('feed', 5), true);
  assert.equal(inventory.consume('feed'), false);
  assert.equal(inventory.consume('egg'), false);
  assert.deepEqual(inventory.getCounts(), { feed: 0, egg: 0 });
  inventory.pickup('feed', 2);
  inventory.pickup('egg');
  assert.equal(inventory.consume('egg'), true);
  assert.deepEqual(inventory.getCounts(), { feed: 2, egg: 0 });
  assert.deepEqual(snapshots, [
    { feed: 5, egg: 0 }, { feed: 0, egg: 0 }, { feed: 2, egg: 0 },
    { feed: 2, egg: 1 }, { feed: 2, egg: 0 },
  ]);
  unsubscribe();
  inventory.pickup('egg');
  assert.equal(snapshots.length, 5);
  assert.deepEqual(createInventory().getCounts(), { feed: 5, egg: 0 });
});

test('invalid quantities do not mutate stacks and returned counts are copies', () => {
  const inventory = createInventory();
  for (const amount of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => inventory.pickup('feed', amount), RangeError);
    assert.throws(() => inventory.consume('feed', amount), RangeError);
  }
  assert.throws(() => inventory.pickup('feed', Number.MAX_SAFE_INTEGER), RangeError);
  const snapshot = inventory.getCounts();
  snapshot.feed = 100;
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
});
