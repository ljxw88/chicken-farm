import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createIsland, GROUND_HEIGHT, GROUND_SIZE, ISLAND_BOTTOM } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createCharacter, CHARACTER_RADIUS } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createCharacterControls } = await vite.ssrLoadModule('/src/character/createCharacterControls.ts');
after(() => vite.close());

class FakeCanvas extends EventTarget {
  tagName = 'CANVAS';
  isContentEditable = false;
  getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
}

globalThis.HTMLElement = FakeCanvas;
globalThis.window = new EventTarget();

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function fixture(t) {
  const scene = new THREE.Scene();
  const { ground, stairs } = createIsland(scene);
  const { obstacles } = createFarmLayout(scene);
  const character = createCharacter();
  const shadow = character.getObjectByName('character-shadow');
  character.position.set(7.2, GROUND_HEIGHT, 0.75);
  scene.add(character);
  const { camera, follow, resize } = createIsometricCamera();
  resize(1280, 720);
  follow(character.position);
  const canvas = new FakeCanvas();
  const controls = createCharacterControls({
    character, camera, canvas, ground, stairs, groundShadow: shadow,
    groundHeight: GROUND_HEIGHT, groundSize: GROUND_SIZE, characterRadius: CHARACTER_RADIUS, obstacles,
  });
  scene.updateMatrixWorld(true);
  const boxes = stairs.treads.map((mesh) => new THREE.Box3().setFromObject(mesh));
  t.after(controls.dispose);

  function key(type, code) {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
  }

  function click(point) {
    camera.updateMatrixWorld();
    const projected = point.clone().project(camera);
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), {
      isPrimary: true, button: 0, clientX: (projected.x + 1) * 640, clientY: (1 - projected.y) * 360,
    }));
  }

  return { scene, ground, stairs, boxes, character, shadow, controls, camera, follow, key, click };
}

// Test the actual capsule against the rendered block volumes, not the height
// function itself. Its lower hemisphere must never intersect a stone riser.
function assertNoClipping(character, boxes) {
  const center = character.position.clone().add(new THREE.Vector3(0, CHARACTER_RADIUS, 0));
  for (const box of boxes) {
    const closest = box.clampPoint(center, new THREE.Vector3());
    assert.ok(center.distanceToSquared(closest) >= CHARACTER_RADIUS ** 2 - 1e-7,
      `capsule intersects a step at ${character.position.toArray()}`);
  }
}

function assertSupported(character, boxes) {
  const { x, z } = character.position;
  const half = GROUND_SIZE / 2;
  // Sample the visible union of the slab and stair tops around the footprint.
  for (let angle = 0; angle < 128; angle++) {
    const px = x + CHARACTER_RADIUS * Math.cos(angle * Math.PI / 64);
    const pz = z + CHARACTER_RADIUS * Math.sin(angle * Math.PI / 64);
    const onIsland = Math.abs(px) <= half + 1e-7 && Math.abs(pz) <= half + 1e-7;
    const onStairs = boxes.some((box) => px >= box.min.x - 1e-7 && px <= box.max.x + 1e-7 &&
      pz >= box.min.z - 1e-7 && pz <= box.max.z + 1e-7);
    assert.ok(onIsland || onStairs, `footprint over void at ${px}, ${pz}`);
  }
}

test('one path-width stone run joins the unchanged slab and spans its rim', (t) => {
  const { scene, ground, stairs, boxes } = fixture(t);
  assert.deepEqual([ground.geometry.parameters.width, ground.geometry.parameters.height], [16, 16]);
  assert.equal(scene.getObjectsByProperty('name', 'island-stone-stairs').length, 1);
  assert.ok(stairs.treads.length >= 3 && stairs.treads.length <= 5);
  near(boxes[0].min.x, GROUND_SIZE / 2);
  near(boxes[0].max.y, GROUND_HEIGHT);
  for (const [index, box] of boxes.entries()) {
    near(box.max.z - box.min.z, 1.2);
    near(box.min.y, ISLAND_BOTTOM);
    if (index > 0) {
      near(box.min.x, boxes[index - 1].max.x);
      assert.ok(box.max.y < boxes[index - 1].max.y);
    }
    const materials = stairs.treads[index].material;
    const luminance = (color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    assert.ok(luminance(materials[2].color) > luminance(materials[0].color), 'tread should be lighter than riser');
  }
  near(boxes.at(-1).max.y, (GROUND_HEIGHT - ISLAND_BOTTOM) / stairs.treads.length);

  const path = scene.getObjectByName('farm-path-surface');
  const ray = new THREE.Raycaster(new THREE.Vector3(7.98, 10, 0.75), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(path).length, 'dirt path must meet the stair entrance');
});

test('WASD descends and climbs without clipping, unsupported feet or an off-edge escape', (t) => {
  const { boxes, character, shadow, controls, key } = fixture(t);
  const seenFloors = new Set();
  function check() {
    assertNoClipping(character, boxes);
    assertSupported(character, boxes);
    const floors = boxes.filter((box) => character.position.x >= box.min.x - 1e-6 && character.position.x <= box.max.x + 1e-6)
      .map((box) => box.max.y);
    if (floors.length === 0) floors.push(GROUND_HEIGHT);
    floors.forEach((floor) => seenFloors.add(floor.toFixed(2)));
    assert.ok(character.position.y >= Math.min(...floors) - 1e-7);
    assert.ok(floors.some((floor) => Math.abs(character.position.y + shadow.position.y - floor - 0.04) < 1e-6));
  }

  key('keydown', 'KeyS');
  key('keydown', 'KeyD'); // World +X, toward the lower end.
  let previous = character.position.y;
  for (let i = 0; i < 200; i++) {
    controls.update(0.01);
    check();
    assert.ok(character.position.y <= previous + 1e-7);
    previous = character.position.y;
  }
  key('keyup', 'KeyS');
  key('keyup', 'KeyD');
  near(character.position.x, boxes.at(-1).max.x - CHARACTER_RADIUS, 0.04);
  near(character.position.y, boxes.at(-1).max.y, 0.06);
  assert.equal(seenFloors.size, boxes.length);

  key('keydown', 'KeyW');
  key('keydown', 'KeyA'); // World -X, back to the plateau.
  previous = character.position.y;
  for (let i = 0; i < 160; i++) {
    controls.update(0.01);
    check();
    assert.ok(character.position.y >= previous - 1e-7);
    previous = character.position.y;
    if (character.position.x < 7.4) break;
  }
  key('keyup', 'KeyW');
  key('keyup', 'KeyA');
  assert.ok(character.position.x < 7.4);
  near(character.position.y, GROUND_HEIGHT);
});

test('the stair sides and the unrelated island rim remain solid during long moves', (t) => {
  const { boxes, character, controls, key } = fixture(t);
  character.position.set(10, GROUND_HEIGHT, 0.75);
  controls.update(0);
  key('keydown', 'KeyS');
  key('keydown', 'KeyA'); // World +Z, into one side of the stairs.
  controls.update(10);
  key('keyup', 'KeyS');
  key('keyup', 'KeyA');
  assert.ok(character.position.z <= boxes[0].max.z - CHARACTER_RADIUS + 1e-7);
  assert.ok(character.position.z > 0.85);
  assertSupported(character, boxes);
  assertNoClipping(character, boxes);

  key('keydown', 'KeyW');
  key('keydown', 'KeyD'); // World -Z, into the opposite side.
  controls.update(10);
  key('keyup', 'KeyW');
  key('keyup', 'KeyD');
  assert.ok(character.position.z >= boxes[0].min.z + CHARACTER_RADIUS - 1e-7);
  assert.ok(character.position.z < 0.65);
  assertSupported(character, boxes);
  assertNoClipping(character, boxes);

  character.position.set(7.5, GROUND_HEIGHT, 2);
  key('keydown', 'KeyS');
  key('keydown', 'KeyD');
  controls.update(10);
  key('keyup', 'KeyS');
  key('keyup', 'KeyD');
  near(character.position.x, GROUND_SIZE / 2 - CHARACTER_RADIUS, 0.1);
  assertSupported(character, boxes);
});

test('clicking a tread walks there and back; clicking a vertical riser does not', (t) => {
  const { boxes, character, controls, click, follow } = fixture(t);
  const bottom = boxes.at(-1);
  click(new THREE.Vector3((bottom.min.x + bottom.max.x) / 2, bottom.max.y, 0.75));
  controls.update(10);
  near(character.position.x, (bottom.min.x + bottom.max.x) / 2, 0.01);
  assertNoClipping(character, boxes);
  assertSupported(character, boxes);

  follow(character.position);
  click(new THREE.Vector3(7.2, GROUND_HEIGHT, 0.75));
  controls.update(10);
  near(character.position.x, 7.2, 0.01);
  near(character.position.y, GROUND_HEIGHT);

  follow(character.position);
  const before = character.position.clone();
  click(new THREE.Vector3(boxes[0].max.x, (boxes[0].max.y + boxes[1].max.y) / 2, 0.75));
  controls.update(10);
  near(character.position.distanceTo(before), 0);
});
