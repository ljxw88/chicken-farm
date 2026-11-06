import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createSupplies } = await vite.ssrLoadModule('/src/inventory/createSupplies.ts');
const { createQaFlockStubs } = await vite.ssrLoadModule('/src/interactions/qa/createQaFlockStubs.ts');
const { createInteractionRegistry } = await vite.ssrLoadModule('/src/interactions/createInteractionRegistry.ts');
after(() => vite.close());

function fixture(t) {
  const scene = new THREE.Scene();
  const character = new THREE.Group();
  scene.add(character);
  const supplies = createSupplies();
  const flock = createQaFlockStubs(scene, 0, { onEggCollected: supplies.addEgg });
  const registry = createInteractionRegistry(character);
  flock.interactables.forEach(registry.register);
  const egg = flock.interactables.find((item) => item.id === 'qa-egg');
  t.after(flock.dispose);
  return { character, supplies, flock, registry, egg };
}

test('a world collect awards five supplies once, even if the list tries afterward', (t) => {
  const { character, supplies, flock, registry, egg } = fixture(t);
  const totals = [];
  const unsubscribe = supplies.subscribe((count) => totals.push(count));
  assert.equal(supplies.getCount(), 0);
  assert.equal(flock.isEggReady(), true);
  assert.equal(registry.interact(egg).performed, false); // The world action still requires range.
  assert.equal(supplies.getCount(), 0);

  character.position.copy(egg.object.position);
  assert.match(registry.interact(egg).message, /Collected egg.*Eggs: 1/);
  assert.equal(supplies.getCount(), 5);
  assert.equal(egg.object.visible, false);
  assert.equal(flock.isEggReady(), false);
  assert.equal(flock.collectEgg(), undefined);
  assert.equal(registry.interact(egg).performed, false);
  assert.equal(supplies.getCount(), 5);
  assert.deepEqual(totals, [0, 5]);
  unsubscribe();
});

test('a list collect works remotely and makes a later world interaction unavailable', (t) => {
  const { character, supplies, flock, registry, egg } = fixture(t);
  character.position.set(-8, 0, -8);
  assert.equal(registry.interact(egg).performed, false);
  assert.match(flock.collectEgg(), /Collected egg.*Eggs: 1/);
  assert.equal(supplies.getCount(), 5);
  assert.equal(egg.object.visible, false);
  character.position.copy(egg.object.position);
  assert.equal(registry.interact(egg).performed, false);
  assert.equal(flock.collectEgg(), undefined);
  assert.equal(supplies.getCount(), 5);
});

test('a disposed stub cannot award supplies, and subscriptions can be removed', (t) => {
  const { supplies, flock } = fixture(t);
  const totals = [];
  const unsubscribe = supplies.subscribe((count) => totals.push(count));
  flock.dispose();
  assert.equal(flock.isEggReady(), false);
  assert.equal(flock.collectEgg(), undefined);
  assert.equal(supplies.getCount(), 0);
  unsubscribe();
  supplies.addEgg();
  assert.equal(supplies.getCount(), 5);
  assert.deepEqual(totals, [0]);
});
