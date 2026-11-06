import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { planWalkRoute } = await vite.ssrLoadModule('/src/character/walkRoute.ts');
const { createStairSurface, stairSupports } = await vite.ssrLoadModule('/src/character/stairSurface.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
after(() => vite.close());

const radius = 0.4;
const bounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
const near = (actual, expected, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not near ${expected}`);

// Independently check each sampled segment against the rendered collision footprints.
function assertRoute(start, route, obstacles, surface, limits = bounds) {
  let previous = start;
  const samples = [];
  for (const target of route) {
    const steps = Math.max(1, Math.ceil(Math.hypot(target.x - previous.x, target.z - previous.z) / 0.02));
    for (let i = 1; i <= steps; i++) {
      const p = { x: previous.x + (target.x - previous.x) * i / steps,
        z: previous.z + (target.z - previous.z) * i / steps };
      assert.ok(p.x >= limits.minX + radius - 1e-8 && p.x <= limits.maxX - radius + 1e-8);
      assert.ok(p.z >= limits.minZ + radius - 1e-8 && p.z <= limits.maxZ - radius + 1e-8);
      if (surface) assert.ok(stairSupports(surface, p.x, p.z, radius), `over void: ${JSON.stringify(p)}`);
      for (const obstacle of obstacles) {
        if (obstacle.blocksWalking === false) continue;
        if (obstacle.kind === 'circle') {
          assert.ok(Math.hypot(p.x - obstacle.x, p.z - obstacle.z) > radius + obstacle.radius - 1e-7,
            `${obstacle.name}: ${JSON.stringify(p)}`);
        } else {
          const d2 = (p.x - Math.max(obstacle.minX, Math.min(obstacle.maxX, p.x))) ** 2 +
            (p.z - Math.max(obstacle.minZ, Math.min(obstacle.maxZ, p.z))) ** 2;
          assert.ok(d2 >= radius ** 2 - 1e-7, `${obstacle.name}: ${JSON.stringify(p)}`);
        }
      }
      samples.push(p);
    }
    previous = target;
  }
  return samples;
}

test('an unobstructed destination remains one exact straight segment', () => {
  const start = { x: 0, z: 0 }, goal = { x: -3, z: 4 };
  const route = planWalkRoute(start, goal, radius, bounds, []);
  assert.deepEqual(route, [goal]);
  assertRoute(start, route, []);
});

test('a reachable destination across a wall routes around it without entering it', () => {
  const wall = { kind: 'box', name: 'wall', minX: 2, maxX: 4, minZ: -1, maxZ: 1 };
  const start = { x: 0, z: 0 }, goal = { x: 6, z: 0 };
  const route = planWalkRoute(start, goal, radius, bounds, [wall]);
  assert.ok(route.length >= 2);
  near(route.at(-1).x, goal.x);
  near(route.at(-1).z, goal.z);
  assertRoute(start, route, [wall]);
});

test('a blocked click reaches the closest free face, even on the far side of the obstacle', () => {
  const wall = { kind: 'box', name: 'wall', minX: 2, maxX: 4, minZ: -1, maxZ: 1 };
  const start = { x: 0, z: 0 }, goal = { x: 3.8, z: 0.2 };
  const route = planWalkRoute(start, goal, radius, bounds, [wall]);
  const end = route.at(-1);
  near(end.x, 4.4, 0.002);
  near(end.z, 0.2, 0.02);
  assertRoute(start, route, [wall]);
});

test('a click inside a round obstacle approaches its nearest radial boundary', () => {
  const tree = { kind: 'circle', name: 'tree', x: 0, z: 0, radius: 0.5 };
  const start = { x: -2, z: 0 }, goal = { x: 0.2, z: 0.1 };
  const route = planWalkRoute(start, goal, radius, bounds, [tree]);
  const end = route.at(-1);
  near(Math.hypot(end.x, end.z), 0.9, 0.002);
  near(Math.hypot(end.x - goal.x, end.z - goal.z), 0.9 - Math.hypot(goal.x, goal.z), 0.002);
  assertRoute(start, route, [tree]);
});

test('a walkable but enclosed destination still approaches the nearest reachable boundary', () => {
  const walls = [
    { kind: 'box', name: 'left', minX: -1, maxX: -0.8, minZ: -1, maxZ: 1 },
    { kind: 'box', name: 'right', minX: 0.8, maxX: 1, minZ: -1, maxZ: 1 },
    { kind: 'box', name: 'top', minX: -1, maxX: 1, minZ: -1, maxZ: -0.8 },
    { kind: 'box', name: 'bottom', minX: -1, maxX: 1, minZ: 0.8, maxZ: 1 },
  ];
  const start = { x: -4, z: 0 }, goal = { x: 0, z: 0 };
  const route = planWalkRoute(start, goal, radius, bounds, walls);
  const end = route.at(-1);
  near(Math.hypot(end.x, end.z), 1.4, 0.02);
  assert.ok(end.x < -1.39, `did not choose the nearer side: ${JSON.stringify(end)}`);
  assertRoute(start, route, walls);
});

test('a destination beyond the island approaches the safe rim without crossing it', () => {
  const start = { x: 0, z: 0 }, goal = { x: -9, z: 3 };
  const route = planWalkRoute(start, goal, radius, bounds, []);
  const end = route.at(-1);
  near(end.x, -7.6, 0.002);
  near(end.z, 3, 0.03);
  assertRoute(start, route, []);
});

test('the nearest point accounts for overlapping obstacle footprints', () => {
  const cross = [
    { kind: 'box', name: 'vertical', minX: -0.2, maxX: 0.2, minZ: -1, maxZ: 1 },
    { kind: 'box', name: 'horizontal', minX: -1, maxX: 1, minZ: -0.2, maxZ: 0.2 },
  ];
  const start = { x: 3, z: -2 }, goal = { x: 0, z: 0 };
  const route = planWalkRoute(start, goal, radius, bounds, cross);
  const end = route.at(-1);
  near(Math.hypot(end.x, end.z), Math.hypot(0.6, 0.6), 0.005);
  assertRoute(start, route, cross);
});

test('overlapping real coop footprints refine the endpoint to their nearest shared corner', () => {
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene);
  const surface = createStairSurface(16, 2.4, 0);
  const start = { x: 0, z: 0 }, goal = { x: 0.29130436745392463, z: -3.0586956325460735 };
  const route = planWalkRoute(start, goal, radius, surface.bounds, obstacles, surface);
  const end = route.at(-1);
  near(end.x, 1.25, 0.001);
  near(end.z, -2.85, 0.001);
  assertRoute(start, route, obstacles, surface, surface.bounds);
});

test('fresh plans honor live walking blockers but ignore placement-only reservations', () => {
  const start = { x: 0, z: 0 }, goal = { x: 3, z: 0 };
  const fence = { kind: 'box', name: 'fence', minX: 1, maxX: 1.2, minZ: -1, maxZ: 1 };
  const obstacles = [];
  assert.deepEqual(planWalkRoute(start, goal, radius, bounds, obstacles), [goal]);
  obstacles.push(fence);
  const around = planWalkRoute(start, goal, radius, bounds, obstacles);
  assert.ok(around.length > 1);
  assertRoute(start, around, obstacles);
  fence.blocksWalking = false;
  assert.deepEqual(planWalkRoute(start, goal, radius, bounds, obstacles), [goal]);
  obstacles.pop();
  assert.deepEqual(planWalkRoute(start, goal, radius, bounds, obstacles), [goal]);
});

test('the real stream and pond route to the stair pad over the existing bridge', () => {
  const scene = new THREE.Scene();
  const { obstacles, bridgeHeight } = createFarmLayout(scene);
  const surface = createStairSurface(16, 2.4, 0);
  const start = { x: 0, z: 0 }, goal = { x: 12.8, z: 0.75 };
  const route = planWalkRoute(start, goal, radius, surface.bounds, obstacles, surface);
  near(route.at(-1).x, goal.x);
  near(route.at(-1).z, goal.z);
  const samples = assertRoute(start, route, obstacles, surface, surface.bounds);
  assert.ok(samples.some((p) => Math.abs((bridgeHeight(p.x, p.z) ?? 0) - 2.52) < 1e-6),
    'the route must actually cross the raised bridge');
});

test('a click just inside the stream collider still moves to its reachable bank', () => {
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene);
  const surface = createStairSurface(16, 2.4, 0);
  const start = { x: 1.2, z: 3.6 }, goal = { x: 2.1, z: 3.6 };
  const route = planWalkRoute(start, goal, radius, surface.bounds, obstacles, surface);
  assert.ok(route.length && Math.hypot(route.at(-1).x - start.x, route.at(-1).z - start.z) > 0.2);
  assertRoute(start, route, obstacles, surface, surface.bounds);
});
