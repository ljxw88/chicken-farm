import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

// Vite loads the same TypeScript modules as the app without a test-only compiler.
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createCharacterControls } = await vite.ssrLoadModule('/src/character/createCharacterControls.ts');
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

function fixture(t) {
  const { camera, follow, resize } = createIsometricCamera();
  resize(800, 600);
  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const character = new THREE.Group();
  const canvas = new FakeElement();
  const controls = createCharacterControls({
    character, camera, canvas, ground, groundSize: 32, groundHeight: 0, characterRadius: 0.4,
  });
  t.after(controls.dispose);

  function key(type, code) {
    window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code }));
  }

  function click(point) {
    camera.updateMatrixWorld();
    const projected = point.clone().project(camera);
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(Object.assign(new Event('pointerdown'), {
      isPrimary: true,
      button: 0,
      clientX: rect.left + (projected.x + 1) * rect.width / 2,
      clientY: rect.top + (1 - projected.y) * rect.height / 2,
    }));
  }

  return { camera, follow, resize, character, controls, key, click };
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
