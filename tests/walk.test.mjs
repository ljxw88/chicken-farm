import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

// Vite loads the same TypeScript modules as the app without a test-only compiler.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createCharacterControls } = await vite.ssrLoadModule('/src/character/createCharacterControls.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { moveWithFarmCollisions } = await vite.ssrLoadModule('/src/scene/farmCollisions.ts');
const { createIsland, GROUND_HEIGHT, GROUND_SIZE } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

class FakeElement extends EventTarget {
  tagName = 'CANVAS';
  isContentEditable = false;

  getBoundingClientRect() {
    return { left: 10, top: 20, width: 800, height: 600 };
  }
}

globalThis.HTMLElement = FakeElement;
globalThis.window = new EventTarget();

function fixture(t, farm = false) {
  const { camera, follow, resize } = createIsometricCamera();
  resize(800, 600);
  const scene = new THREE.Scene();
  const groundHeight = farm ? GROUND_HEIGHT : 0;
  const groundSize = farm ? GROUND_SIZE : 32;
  let ground;
  let stairs;
  if (farm) {
    ({ ground, stairs } = createIsland(scene));
  } else {
    ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), new THREE.MeshBasicMaterial());
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
  }
  const character = new THREE.Group();
  character.position.y = groundHeight;
  follow(character.position);
  const canvas = new FakeElement();
  const obstacles = farm ? createFarmLayout(scene).obstacles : [];
  const controls = createCharacterControls({
    character, camera, canvas, ground, groundSize, groundHeight, characterRadius: 0.4, obstacles, stairs,
  });
  t.after(controls.dispose);

  function key(type, code) {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
  }

  function click(point, height = groundHeight) {
    camera.updateMatrixWorld();
    const projected = point.clone().setY(height).project(camera);
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), {
      isPrimary: true,
      button: 0,
      clientX: rect.left + (projected.x + 1) * rect.width / 2,
      clientY: rect.top + (1 - projected.y) * rect.height / 2,
    }));
  }

  return { camera, follow, resize, character, controls, key, click, groundHeight, stairs, obstacles };
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

test('the orthographic camera keeps its isometric angle and follows through resizing', (t) => {
  const { camera, follow, resize } = fixture(t);
  assert.equal(camera.isOrthographicCamera, true);
  const viewHeight = camera.top - camera.bottom;
  follow(new THREE.Vector3(4, 0, -3));
  const direction = camera.getWorldDirection(new THREE.Vector3());
  for (const component of direction.toArray()) near(component, -1 / Math.sqrt(3));
  near(camera.position.x - 4, camera.position.z + 3);

  resize(600, 900);
  near((camera.right - camera.left) / (camera.top - camera.bottom), 600 / 900);
  near(camera.top - camera.bottom, viewHeight);
});

test('WASD is screen-relative and diagonal walking is not faster', (t) => {
  const { character, controls, key } = fixture(t);
  key('keydown', 'KeyW');
  controls.update(1);
  key('keyup', 'KeyW');
  const straight = character.position.clone();
  assert.ok(straight.x < 0 && straight.z < 0);
  near(straight.y, 0);

  character.position.set(0, 0, 0);
  key('keydown', 'KeyW');
  key('keydown', 'KeyD');
  controls.update(1);
  key('keyup', 'KeyW');
  key('keyup', 'KeyD');
  near(character.position.length(), straight.length());
  near(character.position.x, 0);
  assert.ok(character.position.z < 0);

  character.position.set(0, 0, 0);
  key('keydown', 'KeyD');
  controls.update(1);
  key('keyup', 'KeyD');
  assert.ok(character.position.x > 0 && character.position.z < 0);
});

test('clicking the ground reaches the selected point without overshooting', (t) => {
  const { character, controls, click } = fixture(t);
  const destination = new THREE.Vector3(3, 0, -2);
  click(destination);
  controls.update(10);
  near(character.position.distanceTo(destination), 0);
  controls.update(10);
  near(character.position.distanceTo(destination), 0);
});

test('keyboard input cancels a click destination and blur releases held keys', (t) => {
  const { character, controls, key, click } = fixture(t);
  click(new THREE.Vector3(6, 0, 0));
  controls.update(0.2);
  key('keydown', 'KeyW');
  controls.update(0.2);
  key('keyup', 'KeyW');
  const stopped = character.position.clone();
  controls.update(10);
  near(character.position.distanceTo(stopped), 0);

  key('keydown', 'KeyD');
  controls.update(0.2);
  window.dispatchEvent(new Event('blur'));
  const blurred = character.position.clone();
  controls.update(1);
  near(character.position.distanceTo(blurred), 0);
});

test('walking stays on the floor and within both ground edges', (t) => {
  const { character, controls, key } = fixture(t);
  character.position.set(15.55, 5, 15.55);
  key('keydown', 'KeyS');
  controls.update(1);
  key('keyup', 'KeyS');
  near(character.position.x, 15.6);
  near(character.position.y, 0);
  near(character.position.z, 15.6);

  character.position.set(-15.55, -5, -15.55);
  key('keydown', 'KeyW');
  controls.update(1);
  key('keyup', 'KeyW');
  near(character.position.x, -15.6);
  near(character.position.y, 0);
  near(character.position.z, -15.6);
});

test('the path can be followed from the cottage past the pond to the island rim', (t) => {
  const { character, controls, click, follow, groundHeight } = fixture(t, true);
  const waypoints = [
    [-0.75, -0.65], [-1.6, -1.1], [-3.3, -1.28], [-1.6, -1.1], [-0.75, -0.65], [0, 0],
    [0.85, -0.2], [1.6, -0.9], [2.5, -1.7], [3.4, -1.93], [4.3, -1.95], [5.15, -1.65],
    [6, -0.9], [7.5, 0.4],
  ];
  for (const [x, z] of waypoints) {
    const destination = new THREE.Vector3(x, groundHeight, z);
    click(destination);
    controls.update(10);
    assert.ok(character.position.distanceTo(destination) < 0.001, `could not reach path point ${x}, ${z}`);
    follow(character.position);
  }
});

test('all four island edges stop WASD at the character radius and allow sliding', (t) => {
  const { character, controls, key, groundHeight } = fixture(t, true);
  const cases = [
    { start: [7.45, 5], keys: ['KeyS', 'KeyD'], axis: 'x', expected: 7.6 },
    { start: [-7.45, 5], keys: ['KeyW', 'KeyA'], axis: 'x', expected: -7.6 },
    { start: [6, 7.45], keys: ['KeyS', 'KeyA'], axis: 'z', expected: 7.6 },
    { start: [6, -7.45], keys: ['KeyW', 'KeyD'], axis: 'z', expected: -7.6 },
  ];
  for (const { start, keys, axis, expected } of cases) {
    character.position.set(start[0], groundHeight, start[1]);
    keys.forEach((code) => key('keydown', code));
    controls.update(3);
    controls.update(3);
    keys.forEach((code) => key('keyup', code));
    near(character.position[axis], expected);
    near(character.position.y, groundHeight);
    assert.ok(Math.abs(character.position.x) <= 7.6 && Math.abs(character.position.z) <= 7.6);
  }

  character.position.set(7.55, groundHeight, 2);
  key('keydown', 'KeyS'); // World +X/+Z: push into the rim while moving along it.
  controls.update(1);
  key('keyup', 'KeyS');
  near(character.position.x, 7.6);
  assert.ok(character.position.z > 4.4);
});

test('clicking the void does nothing and clicking the rim stays on the top', (t) => {
  const { character, controls, click, groundHeight } = fixture(t, true);
  click(new THREE.Vector3(9.5, groundHeight, 0));
  controls.update(10);
  near(character.position.x, 0);
  near(character.position.z, 0);

  click(new THREE.Vector3(7.95, groundHeight, 0));
  controls.update(10);
  near(character.position.x, 7.6);
  near(character.position.z, 0);
  near(character.position.y, groundHeight);
});

test('click-to-walk reaches the foot pad and returns to the original island', (t) => {
  const { character, controls, click, follow, groundHeight, stairs } = fixture(t, true);
  const { footPad } = stairs;
  const destination = new THREE.Vector3(footPad.position.x, footPad.position.y + footPad.geometry.parameters.height / 2, footPad.position.z);
  click(destination, destination.y);
  for (let i = 0; i < 4; i++) controls.update(10);
  near(character.position.x, destination.x, 0.01);
  near(character.position.z, destination.z, 0.01);
  assert.ok(character.position.y >= destination.y && character.position.y < groundHeight);

  follow(character.position);
  click(new THREE.Vector3(7.2, groundHeight, 0.75));
  for (let i = 0; i < 4; i++) controls.update(10);
  near(character.position.x, 7.2, 0.01);
  near(character.position.y, groundHeight);
  near(character.position.z, 0.75, 0.01);
});

test('WASD cannot tunnel through the front or side of the replacement buildings', (t) => {
  const { character, controls, key, groundHeight, obstacles } = fixture(t, true);
  const cottage = obstacles.find((obstacle) => obstacle.name === 'cottage');
  const coop = obstacles.find((obstacle) => obstacle.name === 'ramp-coop-2');
  character.position.set((cottage.minX + cottage.maxX) / 2, groundHeight, cottage.maxZ + 1.3);
  key('keydown', 'KeyW');
  key('keydown', 'KeyD'); // Screen up + right is world -Z.
  controls.update(10);
  key('keyup', 'KeyW');
  key('keyup', 'KeyD');
  assert.ok(character.position.z >= cottage.maxZ + 0.4 - 1e-8 && character.position.z < cottage.maxZ + 0.55);

  character.position.set(coop.maxX + 1.3, groundHeight, (coop.minZ + coop.maxZ) / 2);
  key('keydown', 'KeyW');
  key('keydown', 'KeyA'); // Screen up + left is world -X.
  controls.update(10);
  key('keyup', 'KeyW');
  key('keyup', 'KeyA');
  assert.ok(character.position.x >= coop.maxX + 0.4 - 1e-8 && character.position.x < coop.maxX + 0.55);
});

test('click-to-move stops at a tree trunk, even with a long update', (t) => {
  const { character, controls, click } = fixture(t, true);
  character.position.set(-0.75, 0, 1.55);
  click(new THREE.Vector3(-3.65, 0, 1.55));
  controls.update(10);
  // The first trunk has radius 0.304; the character has radius 0.4.
  assert.ok(character.position.x >= -2.15 + 0.704 - 1e-8);
  assert.ok(character.position.x < -2.15 + 0.804);
  const stopped = character.position.clone();
  controls.update(10);
  near(character.position.distanceTo(stopped), 0);
  click(new THREE.Vector3(-0.75, 0, 1.55));
  controls.update(10);
  near(character.position.x, -0.75);
});

test('clicks also stop at the cottage and WASD also stops at trees', (t) => {
  const { character, controls, click, key, groundHeight, obstacles } = fixture(t, true);
  const cottage = obstacles.find((obstacle) => obstacle.name === 'cottage');
  const cottageX = (cottage.minX + cottage.maxX) / 2;
  character.position.set(cottageX, groundHeight, cottage.maxZ + 1.3);
  click(new THREE.Vector3(cottageX, groundHeight, (cottage.minZ + cottage.maxZ) / 2));
  controls.update(10);
  assert.ok(character.position.z >= cottage.maxZ + 0.4 - 1e-8 && character.position.z < cottage.maxZ + 0.55);

  character.position.set(-0.75, 0, 1.55);
  key('keydown', 'KeyW');
  key('keydown', 'KeyA');
  controls.update(10);
  key('keyup', 'KeyW');
  key('keyup', 'KeyA');
  assert.ok(character.position.x >= -2.15 + 0.704 - 1e-8);
  assert.ok(character.position.x < -2.15 + 0.804);
});

test('the pond water also blocks movement', (t) => {
  const { character, controls, click } = fixture(t, true);
  character.position.set(1.3, 0, -3.5);
  click(new THREE.Vector3(6, 0, -3.5));
  controls.update(10);
  assert.ok(character.position.x <= 1.9725 + 1e-8);
  assert.ok(character.position.x > 1.85);
});

test('a glancing movement slides along a solid wall', () => {
  const wall = { kind: 'box', name: 'wall', minX: 0, maxX: 2, minZ: 0, maxZ: 2 };
  const result = moveWithFarmCollisions(-1, 0.5, 1, 0.8, 0.4, [wall]);
  assert.ok(result.x <= -0.4 + 1e-8);
  assert.ok(result.x > -0.55);
  assert.ok(result.z > 1.25);
});

test('a diagonal step cannot bypass a prop by travelling outside the island', () => {
  const bounds = { minX: -8, maxX: 8, minZ: -8, maxZ: 8 };
  const wall = { kind: 'box', name: 'rim-wall', minX: 7.2, maxX: 8, minZ: 0, maxZ: 1 };
  const result = moveWithFarmCollisions(7.6, -1, 5, 4, 0.4, [wall], bounds);
  near(result.x, 7.6);
  assert.ok(result.z <= -0.4 && result.z > -0.5);
});
