import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';
import { loadCharacterFixture } from './characterFixture.mjs';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createIsland, GROUND_HEIGHT, GROUND_SIZE, ISLAND_BOTTOM } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createCharacter, CHARACTER_RADIUS } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const createCharacterControls = await loadCharacterFixture(vite);
const { FARM_PALETTE } = await vite.ssrLoadModule('/src/content/slots.ts');
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
  const treadBoxes = stairs.treads.map((mesh) => new THREE.Box3().setFromObject(mesh));
  const padBox = new THREE.Box3().setFromObject(stairs.footPad);
  const boxes = [...treadBoxes, padBox];
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

  return { scene, ground, stairs, treadBoxes, padBox, boxes, character, shadow, controls, camera, follow, key, click };
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

test('a path-width stone run and small foot pad join the unchanged slab', (t) => {
  const { scene, ground, stairs, treadBoxes, padBox } = fixture(t);
  assert.deepEqual([ground.geometry.parameters.width, ground.geometry.parameters.height], [16, 16]);
  assert.equal(scene.getObjectsByProperty('name', 'island-stone-stairs').length, 1);
  assert.ok(stairs.treads.length >= 3 && stairs.treads.length <= 5);
  near(treadBoxes[0].min.x, GROUND_SIZE / 2);
  near(treadBoxes[0].max.y, GROUND_HEIGHT);
  for (const [index, box] of treadBoxes.entries()) {
    near(box.max.z - box.min.z, 1.2);
    near(box.min.y, ISLAND_BOTTOM);
    if (index > 0) {
      near(box.min.x, treadBoxes[index - 1].max.x);
      assert.ok(box.max.y < treadBoxes[index - 1].max.y);
    }
  }
  near(treadBoxes.at(-1).max.y, (GROUND_HEIGHT - ISLAND_BOTTOM) / stairs.treads.length);
  near(padBox.max.x - padBox.min.x, 1.5);
  near(padBox.max.z - padBox.min.z, 1.6);
  near(padBox.max.y - padBox.min.y, 0.16);
  near(padBox.min.y, ISLAND_BOTTOM);
  assert.ok(padBox.min.x < treadBoxes.at(-1).max.x && padBox.max.x > treadBoxes.at(-1).max.x);
  assert.ok(padBox.min.z < treadBoxes.at(-1).min.z && padBox.max.z > treadBoxes.at(-1).max.z);
  assert.ok(padBox.max.y < treadBoxes.at(-1).max.y);

  const path = scene.getObjectByName('farm-path-surface');
  const ray = new THREE.Raycaster(new THREE.Vector3(7.98, 10, 0.75), new THREE.Vector3(0, -1, 0));
  assert.ok(ray.intersectObject(path).length, 'dirt path must meet the stair entrance');
});

test('stone derives from the barn and path, with subtle variations and non-emissive tread edges', (t) => {
  const { stairs, treadBoxes, padBox } = fixture(t);
  const barn = new THREE.Color(FARM_PALETTE.barnWood);
  const dirt = new THREE.Color(FARM_PALETTE.dirt);
  const luminance = (color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const colors = [];
  const ray = new THREE.Raycaster();
  for (const [mesh, box] of [...stairs.treads.map((step, index) => [step, treadBoxes[index]]), [stairs.footPad, padBox]]) {
    const [riser, , tread, , , , edge] = mesh.material;
    for (const channel of ['r', 'g', 'b']) {
      assert.ok(riser.color[channel] >= dirt[channel] && riser.color[channel] <= barn[channel]);
      assert.ok(tread.color[channel] >= dirt[channel] && tread.color[channel] <= barn[channel]);
    }
    assert.ok(luminance(tread.color) > luminance(riser.color));
    assert.ok(luminance(edge.color) > luminance(tread.color));
    assert.ok(mesh.material.every((material) => material.emissive.getHex() === 0));
    ray.set(new THREE.Vector3(box.max.x - 0.075, box.max.y + 1, (box.min.z + box.max.z) / 2), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(mesh)[0];
    assert.equal(hit.face.materialIndex, 6, 'visible front edge has its own lighter tint');
    colors.push(tread.color.getHex());
  }
  assert.ok(new Set(colors.slice(0, -1)).size > 1, 'treads have small value variations');
  const lightness = stairs.treads.map((step) => luminance(step.material[2].color));
  assert.ok(Math.max(...lightness) - Math.min(...lightness) < 0.05);
});

test('WASD descends to the pad and climbs without clipping or an off-edge escape', (t) => {
  const { boxes, treadBoxes, padBox, character, shadow, controls, key } = fixture(t);
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
  near(character.position.x, padBox.max.x - CHARACTER_RADIUS, 0.04);
  near(character.position.y, padBox.max.y, 0.01);
  assert.equal(seenFloors.size, treadBoxes.length + 1);

  key('keydown', 'KeyW');
  key('keydown', 'KeyA'); // World -X, back to the plateau.
  previous = character.position.y;
  for (let i = 0; i < 200; i++) {
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

test('climbing after pushing either pad side, or both sides in sequence, does not pin the character', (t) => {
  const { boxes, padBox, character, controls, key } = fixture(t);
  const cases = [
    { name: 'S+A', pushes: [['KeyS', 'KeyA']], climbSeconds: 4 },
    { name: 'W+D', pushes: [['KeyW', 'KeyD']], climbSeconds: 6 },
    { name: 'S+D, S+A, W+D', pushes: [['KeyS', 'KeyD'], ['KeyS', 'KeyA'], ['KeyW', 'KeyD']], climbSeconds: 6 },
  ];

  function hold(codes, seconds, deltaSeconds) {
    codes.forEach((code) => key('keydown', code));
    for (let frame = 0; frame < Math.round(seconds / deltaSeconds); frame++) {
      const previous = character.position.clone();
      controls.update(deltaSeconds);
      assertSupported(character, boxes);
      assertNoClipping(character, boxes);
      assert.ok(Math.hypot(character.position.x - previous.x, character.position.z - previous.z) <= 3.5 * deltaSeconds + 1e-6);
    }
    codes.forEach((code) => key('keyup', code));
  }

  for (const deltaSeconds of [1 / 60, 0.1]) {
    for (const scenario of cases) {
      character.position.set((padBox.min.x + padBox.max.x) / 2, padBox.max.y, 0.75);
      controls.update(0);
      scenario.pushes.forEach((codes) => hold(codes, 2.2, deltaSeconds));
      hold(['KeyW', 'KeyA'], scenario.climbSeconds, deltaSeconds);
      assert.ok(character.position.x < 7.6, `${scenario.name} at ${deltaSeconds}s: stuck at ${character.position.toArray()}`);
      near(character.position.y, GROUND_HEIGHT);
    }
  }
});

test('stair and pad sides, inside corners and the unrelated rim remain solid during long moves', (t) => {
  const { boxes, treadBoxes, padBox, character, controls, key } = fixture(t);
  character.position.set(10, GROUND_HEIGHT, 0.75);
  controls.update(0);
  key('keydown', 'KeyS');
  key('keydown', 'KeyA'); // World +Z, into one side of the stairs.
  controls.update(10);
  key('keyup', 'KeyS');
  key('keyup', 'KeyA');
  assert.ok(character.position.z <= treadBoxes[0].max.z - CHARACTER_RADIUS + 1e-7);
  assert.ok(character.position.z > 0.85);
  assertSupported(character, boxes);
  assertNoClipping(character, boxes);

  key('keydown', 'KeyW');
  key('keydown', 'KeyD'); // World -Z, into the opposite side.
  controls.update(10);
  key('keyup', 'KeyW');
  key('keyup', 'KeyD');
  assert.ok(character.position.z >= treadBoxes[0].min.z + CHARACTER_RADIUS - 1e-7);
  assert.ok(character.position.z < 0.65);
  assertSupported(character, boxes);
  assertNoClipping(character, boxes);

  character.position.set(13, GROUND_HEIGHT, 0.75);
  controls.update(0);
  key('keydown', 'KeyS');
  key('keydown', 'KeyA');
  controls.update(10);
  key('keyup', 'KeyS');
  key('keyup', 'KeyA');
  near(character.position.z, padBox.max.z - CHARACTER_RADIUS, 1e-6);
  assertSupported(character, boxes);
  key('keydown', 'KeyW');
  key('keydown', 'KeyD');
  controls.update(10);
  key('keyup', 'KeyW');
  key('keyup', 'KeyD');
  near(character.position.z, padBox.min.z + CHARACTER_RADIUS, 1e-6);
  assertSupported(character, boxes);
  assertNoClipping(character, boxes);

  character.position.set(12.8, GROUND_HEIGHT, 1.1);
  controls.update(0);
  key('keydown', 'KeyW');
  key('keydown', 'KeyA'); // Push from the wider pad toward the narrow stairs.
  controls.update(1);
  key('keyup', 'KeyW');
  key('keyup', 'KeyA');
  assert.ok(character.position.x < padBox.min.x - 1, 'should slide past the inside corner');
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

test('clicking the pad and a tinted edge walks there; a vertical riser is not a destination', (t) => {
  const { boxes, treadBoxes, padBox, character, controls, click, follow } = fixture(t);
  click(new THREE.Vector3((padBox.min.x + padBox.max.x) / 2, padBox.max.y, 0.75));
  controls.update(10);
  near(character.position.x, (padBox.min.x + padBox.max.x) / 2, 0.01);
  assertNoClipping(character, boxes);
  assertSupported(character, boxes);

  follow(character.position);
  click(new THREE.Vector3(padBox.max.x - 0.075, padBox.max.y, 0.75));
  controls.update(10);
  near(character.position.x, padBox.max.x - CHARACTER_RADIUS, 0.01);
  assertSupported(character, boxes);

  follow(character.position);
  click(new THREE.Vector3(13, padBox.max.y, padBox.max.z - 0.45));
  controls.update(10);
  near(character.position.z, padBox.max.z - 0.45, 0.01);
  assertSupported(character, boxes);

  follow(character.position);
  click(new THREE.Vector3(7.2, GROUND_HEIGHT, 0.75));
  for (let i = 0; i < 4; i++) controls.update(10);
  near(character.position.x, 7.2, 0.01);
  near(character.position.y, GROUND_HEIGHT);

  follow(character.position);
  const edge = treadBoxes[1];
  click(new THREE.Vector3(edge.max.x - 0.075, edge.max.y, 0.75));
  controls.update(10);
  near(character.position.x, edge.max.x - 0.075, 0.01);
  assertNoClipping(character, boxes);

  follow(character.position);
  click(new THREE.Vector3(7.2, GROUND_HEIGHT, 0.75));
  controls.update(10);
  follow(character.position);
  const before = character.position.clone();
  click(new THREE.Vector3(treadBoxes[0].max.x, (treadBoxes[0].max.y + treadBoxes[1].max.y) / 2, 0.75));
  controls.update(10);
  near(character.position.distanceTo(before), 0);
});
