import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';
import { readSpec } from '../tools/assetgen/config.mjs';
import { chooseContextPlacement, overlapsContextFootprint } from '../tools/assetgen/context-placement.js';
import { createSignedFixtures } from '../tools/assetgen/signed-fixtures.mjs';

const server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
const { createFarmLayout } = await server.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createPlacementVisual } = await server.ssrLoadModule('/src/placement/createPlacementVisual.ts');
const { createCharacter } = await server.ssrLoadModule('/src/character/createCharacter.ts');
after(() => server.close());

test('the old barrel composite position intersects the real stream; the replacement is clear for P0 bounds', async () => {
  const scene = new THREE.Scene(), layout = createFarmLayout(scene);
  const fence = createPlacementVisual('fence'); fence.position.set(0, 2.4, 4.1); scene.add(fence);
  const character = createCharacter(); character.position.set(-0.5, 2.4, 2.6); scene.add(character);
  const box = (object) => { const b = new THREE.Box3().setFromObject(object); return { kind: 'box', minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z }; };
  const obstacles = [...layout.splashExclusions, ...layout.obstacles, box(fence), box(character)];
  const old = { minX: 2.5 - 0.43, maxX: 2.5 + 0.43, minZ: 3 - 0.43, maxZ: 3 + 0.43 };
  assert.ok(layout.splashExclusions.some((obstacle) => obstacle.name?.startsWith('stream-water') && overlapsContextFootprint(old, obstacle)));
  for (const id of ['round-oak-a', 'round-oak-b', 'small-bush', 'rock-a', 'rock-b', 'rock-c', 'barrel', 'crate', 'hay-bale']) {
    const { spec } = await readSpec(id), w = spec.size.width * 0.55, d = spec.size.depth * 0.55;
    const placement = chooseContextPlacement({ minX: -w, maxX: w, minZ: -d, maxZ: d }, obstacles);
    assert.ok(placement, `${id} has no safe context position`);
    assert.deepEqual([placement.x, placement.z], [-2, 4.2], id);
    assert.ok(!obstacles.some((obstacle) => overlapsContextFootprint(placement.footprint, obstacle)), id);
  }
  const signed = await createSignedFixtures(server);
  for (const name of signed.names) {
    const [width, , depth] = signed.expected[name].size;
    const placement = chooseContextPlacement({ minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 }, obstacles);
    assert.ok(placement, `signed ${name} has no safe context position`);
    assert.ok(!obstacles.some((obstacle) => overlapsContextFootprint(placement.footprint, obstacle)), name);
  }
});

test('context selection respects boxes, circles, ground edges and unknown obstacles', () => {
  const bounds = { minX: -0.4, maxX: 0.4, minZ: -0.4, maxZ: 0.4 };
  const candidates = [{ x: 0, z: 0 }, { x: 2, z: 0 }];
  assert.deepEqual(chooseContextPlacement(bounds, [{ kind: 'circle', x: 0, z: 0, radius: 0.5 }], { candidates })?.x, 2);
  assert.equal(chooseContextPlacement(bounds, [{ kind: 'unknown' }], { candidates }), null);
  assert.equal(chooseContextPlacement(bounds, [null], { candidates }), null);
  assert.equal(chooseContextPlacement(bounds, [{ kind: 'circle', x: NaN, z: 0, radius: 1 }], { candidates }), null);
  assert.equal(chooseContextPlacement(bounds, [], { candidates: [{ x: 8, z: 0 }] }), null);
  assert.equal(chooseContextPlacement({ ...bounds, minX: NaN }, [], { candidates }), null);
});
