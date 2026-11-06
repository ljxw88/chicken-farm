import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createEconomy } = await vite.ssrLoadModule('/src/inventory/createEconomy.ts');
const { createInventory } = await vite.ssrLoadModule('/src/inventory/createInventory.ts');
const { createSupplies } = await vite.ssrLoadModule('/src/inventory/createSupplies.ts');
const { createQaFenceStub } = await vite.ssrLoadModule('/src/interactions/qa/createQaFenceStub.ts');
const { createQaFlockStubs } = await vite.ssrLoadModule('/src/interactions/qa/createQaFlockStubs.ts');
after(() => vite.close());

function fixture(t) {
  const scene = new THREE.Scene();
  const supplies = createSupplies();
  const inventory = createInventory();
  const fence = createQaFenceStub(scene, 0);
  const economy = createEconomy({ supplies, inventory, fence });
  const flock = createQaFlockStubs(scene, 0, { inventory, onEggCollected: supplies.addEgg });
  t.after(() => { flock.dispose(); fence.dispose(); });
  return { scene, supplies, inventory, economy, fence, flock };
}

test('feed, world collect, sell, buy Feed and place a fence follow the signed Supplies rates', (t) => {
  const { scene, supplies, inventory, economy, fence, flock } = fixture(t);
  const chicken = flock.interactables.find((item) => item.id === 'qa-chicken');
  assert.equal(supplies.getCount(), 0);
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
  assert.match(chicken.interact(), /Fed chicken.*\+1 Egg/);
  assert.deepEqual(inventory.getCounts(), { feed: 4, egg: 1 });
  assert.equal(supplies.getCount(), 0);

  assert.match(flock.collectEgg(), /\+5 Supplies/);
  assert.equal(flock.collectEgg(), undefined);
  assert.equal(supplies.getCount(), 5);
  assert.deepEqual(inventory.getCounts(), { feed: 4, egg: 1 });
  assert.equal(economy.sellEgg().ok, true);
  assert.equal(supplies.getCount(), 8);
  assert.deepEqual(inventory.getCounts(), { feed: 4, egg: 0 });
  assert.equal(economy.buyFeed().ok, true);
  assert.equal(supplies.getCount(), 7);
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });

  assert.equal(scene.getObjectByName('qa-paid-fence'), undefined);
  assert.equal(economy.placeFence().ok, true);
  assert.equal(supplies.getCount(), 2);
  assert.equal(fence.isPlaced(), true);
  const segment = scene.getObjectByName('qa-paid-fence');
  assert.ok(segment?.visible);
  assert.ok(segment.children.some((child) => child instanceof THREE.Mesh));
  assert.match(economy.sellEgg().message, /Can't sell/);
  assert.match(economy.placeFence().message, /Can't place fence.*5 Supplies/);
  assert.equal(supplies.getCount(), 2);
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
});

test('insufficient funds never change stacks or place a fence, and exact balances work', (t) => {
  const { scene, supplies, inventory, economy, flock } = fixture(t);
  assert.match(economy.sellEgg().message, /Can't sell/);
  assert.match(economy.buyFeed().message, /Can't buy Feed/);
  assert.match(economy.placeFence().message, /Can't place fence/);
  assert.equal(supplies.getCount(), 0);
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
  assert.equal(scene.getObjectByName('qa-paid-fence'), undefined);

  inventory.pickup('egg');
  assert.equal(economy.sellEgg().ok, true); // 3 Supplies
  assert.match(economy.placeFence().message, /Can't place fence/);
  assert.equal(supplies.getCount(), 3);
  assert.equal(scene.getObjectByName('qa-paid-fence'), undefined);
  for (let i = 0; i < 3; i++) assert.equal(economy.buyFeed().ok, true);
  assert.equal(supplies.getCount(), 0);
  assert.deepEqual(inventory.getCounts(), { feed: 8, egg: 0 });
  assert.match(economy.buyFeed().message, /Can't buy Feed/);
  assert.deepEqual(inventory.getCounts(), { feed: 8, egg: 0 });

  flock.collectEgg(); // Exactly 5 Supplies can pay for the fence.
  assert.equal(economy.placeFence().ok, true);
  assert.equal(supplies.getCount(), 0);
  supplies.add(5);
  assert.match(economy.placeFence().message, /already placed/);
  assert.equal(supplies.getCount(), 5);
  assert.equal(scene.children.filter((child) => child.name === 'qa-paid-fence').length, 1);
});

test('selling consumes one inventory Egg at a time and cannot sell the world egg', (t) => {
  const { supplies, inventory, economy, flock } = fixture(t);
  assert.match(economy.sellEgg().message, /Can't sell/);
  assert.equal(flock.isEggReady(), true);
  inventory.pickup('egg', 2);
  assert.equal(economy.sellEgg().ok, true);
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 1 });
  assert.equal(supplies.getCount(), 3);
  assert.equal(economy.sellEgg().ok, true);
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
  assert.equal(supplies.getCount(), 6);
  assert.match(economy.sellEgg().message, /Can't sell/);
  assert.equal(supplies.getCount(), 6);
  assert.equal(flock.isEggReady(), true);
});

test('failed placement is refunded and invalid Supplies amounts cannot mutate the balance', () => {
  const supplies = createSupplies();
  const inventory = createInventory();
  const economy = createEconomy({ inventory, supplies, fence: { isPlaced: () => false, place: () => false } });
  supplies.add(5);
  assert.match(economy.placeFence().message, /Can't place fence/);
  assert.equal(supplies.getCount(), 5);
  assert.deepEqual(inventory.getCounts(), { feed: 5, egg: 0 });
  for (const amount of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => supplies.add(amount), RangeError);
    assert.throws(() => supplies.spend(amount), RangeError);
  }
  assert.throws(() => supplies.add(Number.MAX_SAFE_INTEGER), RangeError);
  assert.equal(supplies.spend(6), false);
  assert.equal(supplies.getCount(), 5);
});

test('a disposed fence preview cannot be placed or charged', (t) => {
  const { scene, supplies, economy, fence } = fixture(t);
  supplies.add(5);
  fence.dispose();
  assert.equal(fence.isPlaced(), false);
  assert.match(economy.placeFence().message, /Can't place fence/);
  assert.equal(supplies.getCount(), 5);
  assert.equal(scene.getObjectByName('qa-paid-fence'), undefined);
});
