import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
const { createInputActions } = await vite.ssrLoadModule('/src/core/input/actions.ts');
const { createMovementSystem } = await vite.ssrLoadModule('/src/character/movementSystem.ts');
const { createCharacterController } = await vite.ssrLoadModule('/src/character/createCharacterController.ts');
const { createStairSurface, stairSupports } = await vite.ssrLoadModule('/src/character/stairSurface.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
after(() => vite.close());

const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
const idle = { type: 'move', right: 0, forward: 0, active: false };
const plusX = { type: 'move', right: 1, forward: -1, active: true };
const minusX = { type: 'move', right: -1, forward: 1, active: true };

function fixture(position = [0, 2.4, 0], surface) {
  const world = createEntityWorld();
  const { camera, resize } = createIsometricCamera();
  resize(1280, 720);
  const bounds = surface?.bounds ?? { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
  const player = world.create({ transform: { position: [...position], yaw: 0 },
    character: { radius: 0.4, groundHeight: 2.4, bounds, target: null, floorHeight: 2.4 } });
  if (surface) world.create({ stairSurface: surface });
  return { world, player, camera, move: createMovementSystem(camera) };
}

test('movement system applies screen-relative keys, diagonal normalization and click targets to entities', () => {
  const f = fixture();
  f.move(f.world, { type: 'move', right: 0, forward: -1, active: true }, 0.2);
  near(f.player.transform.position[0], 0.7 / Math.sqrt(2));
  near(f.player.transform.position[2], 0.7 / Math.sqrt(2));
  near(f.player.transform.yaw, Math.PI / 4);
  f.player.transform.position = [0, 2.4, 0];
  f.move(f.world, plusX, 0.2);
  near(f.player.transform.position[0], 0.7);
  near(f.player.transform.position[2], 0);
  f.player.character.target = [1, 2.4, 0];
  f.move(f.world, idle, 10);
  near(f.player.transform.position[0], 1);
  assert.equal(f.player.character.target, null, 'a click target stops without overshooting');
  f.player.character.target = [2, 2.4, 0];
  f.move(f.world, { type: 'move', right: 0, forward: 0, active: true }, 1);
  near(f.player.transform.position[0], 1); // Opposing held keys still suppress a target.
  assert.deepEqual(JSON.parse(JSON.stringify(f.player)).transform.position, f.player.transform.position);
});

test('a frame between chord keydowns keeps the original single-key motion', () => {
  const f = fixture();
  f.move(f.world, { type: 'move', right: 0, forward: -1, active: true }, 1 / 60);
  const single = 3.5 / 60 / Math.sqrt(2);
  near(f.player.transform.position[0], single);
  near(f.player.transform.position[2], single);
  f.move(f.world, { type: 'move', right: -1, forward: -1, active: true }, 1 / 60);
  near(f.player.transform.position[0], single);
  near(f.player.transform.position[2], single + 3.5 / 60);
});

test('obstacle entities slide a circular footprint along a wall rather than tunnelling', () => {
  const f = fixture([-1, 2.4, 0.5]);
  f.world.create({ obstacle: { kind: 'box', name: 'wall', minX: 0, maxX: 2, minZ: 0, maxZ: 2 } });
  f.move(f.world, { type: 'move', right: 0, forward: -1, active: true }, 0.3);
  const [x, , z] = f.player.transform.position;
  assert.ok(x <= -0.4 && x > -0.55, `wall penetration or premature stop: ${x}`);
  assert.ok(z > 1.2, `expected a glancing slide: ${z}`);
});

test('stair surface entities enforce the void, capsule height and pad-corner slide', () => {
  const surface = createStairSurface(16, 2.4, 0);
  const f = fixture([7.55, 2.4, 2], surface);
  f.move(f.world, plusX, 1);
  near(f.player.transform.position[0], 7.6);
  assert.ok(stairSupports(surface, f.player.transform.position[0], f.player.transform.position[2], 0.4));
  f.player.transform.position = [10, 0, 0.75];
  f.move(f.world, idle, 0);
  near(f.player.character.floorHeight, 1.44);
  near(f.player.transform.position[1], 1.92 - 0.4 + Math.sqrt(0.4 ** 2 - 0.2 ** 2));
  f.player.transform.position = [12.8, 0.16, 1.1];
  f.move(f.world, minusX, 1);
  assert.ok(f.player.transform.position[0] < 11.05, 'pad corner must slide into the stair opening');
  assert.ok(stairSupports(surface, f.player.transform.position[0], f.player.transform.position[2], 0.4));
});

test('actual cottage and water obstacle entities retain the bridge opening and graded height', () => {
  const scene = new THREE.Scene();
  const layout = createFarmLayout(scene);
  const bridge = layout.obstacles.find((item) => item.name === 'wooden-bridge');
  const water = layout.obstacles.filter((item) => item.name.startsWith('stream-water-'));
  const cottage = layout.obstacles.find((item) => item.name === 'cottage');
  assert.ok(cottage && water.length > 10 && bridge);
  assert.equal(bridge.blocksWalking, false);
  assert.ok(water.every((item) => !(item.minX < bridge.maxX && item.maxX > bridge.minX &&
    item.minZ < bridge.maxZ && item.maxZ > bridge.minZ)), 'no water box may fill the deck opening');

  const f = fixture([2.5, 2.4, -1.95]);
  for (const obstacle of layout.obstacles) f.world.create({ obstacle });
  const movement = createMovementSystem(f.camera, layout.bridgeHeight);
  movement(f.world, plusX, 0.4);
  near(f.player.transform.position[0], 3.9);
  near(f.player.transform.position[1], 2.52);
  for (const [index, x] of [3.3, 3.7, 4.1, 4.5].entries()) {
    const gap = scene.getObjectByName(`bridge-gap-${index + 1}`);
    gap.geometry.computeBoundingBox();
    near(gap.geometry.boundingBox.max.x - gap.geometry.boundingBox.min.x, 0.04, 1e-6);
    f.player.transform.position = [x, 2.4, -1.95];
    movement(f.world, idle, 0);
    near(f.player.transform.position[1], 2.52, 1e-7);
  }
  f.player.transform.position = [1.2, 2.4, 3.6];
  movement(f.world, plusX, 1);
  assert.ok(f.player.transform.position[0] > 1.2 && f.player.transform.position[0] < 2, 'stream must stop walking');

  const building = fixture([(cottage.minX + cottage.maxX) / 2, 2.4, cottage.maxZ + 1.3]);
  building.world.create({ obstacle: cottage }); // Isolate the real EBR-47 box.
  building.move(building.world, { type: 'move', right: 1, forward: 1, active: true }, 2);
  const z = building.player.transform.position[2];
  assert.ok(z >= cottage.maxZ + 0.4 - 1e-8 && z < cottage.maxZ + 0.55, `cottage was crossed at z=${z}`);
});

test('shared placement obstacle additions, mutations and removals immediately reach the ECS system', () => {
  const f = fixture();
  f.world.remove(f.player);
  const input = createInputActions();
  const character = new THREE.Group();
  character.position.y = 2.4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial());
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
  const obstacles = [];
  const controller = createCharacterController({ world: f.world, input, character, camera: f.camera, canvas, ground,
    groundSize: 16, groundHeight: 2.4, characterRadius: 0.4, obstacles });
  const fence = { kind: 'box', name: 'placed-fence', minX: 1, maxX: 1.2, minZ: -0.5, maxZ: 0.5 };
  obstacles.push(fence);
  input.keyDown({ code: 'KeyS', target: null });
  input.keyDown({ code: 'KeyD', target: null });
  controller.update(1);
  assert.ok(character.position.x <= 0.6 && character.position.x >= 0.5 - 1e-8);
  assert.equal([...f.world.with('obstacle')][0].obstacle, fence);
  fence.blocksWalking = false; // Placement still holds the exact same footprint.
  character.position.set(0, 2.4, 0);
  controller.update(1);
  near(character.position.x, 3.5);
  obstacles.splice(0, 1);
  character.position.set(0, 2.4, 0);
  controller.update(1);
  near(character.position.x, 3.5);
  assert.equal([...f.world.with('obstacle')].length, 0);
  controller.dispose();
});
