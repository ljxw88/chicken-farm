import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createCharacterControls } = await vite.ssrLoadModule('/src/character/createCharacterControls.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createInteractionRegistry } = await vite.ssrLoadModule('/src/interactions/createInteractionRegistry.ts');
const { createInteractionController } = await vite.ssrLoadModule('/src/interactions/createInteractionController.ts');
after(() => vite.close());

class FakeElement extends EventTarget {
  constructor(tagName = 'CANVAS') {
    super();
    this.tagName = tagName;
    this.isContentEditable = false;
  }
  getBoundingClientRect() {
    return { left: 10, top: 20, width: 800, height: 600 };
  }
}

class FakeView {
  shown;
  messages = [];
  callback;
  show(interactable, x, y) { this.shown = { interactable, x, y }; }
  hide() { this.shown = undefined; }
  showMessage(message) { this.messages.push(message); }
  onActivate(callback) {
    this.callback = callback;
    return () => { this.callback = undefined; };
  }
  click() { this.callback?.(); }
}

globalThis.HTMLElement = FakeElement;
globalThis.window = new EventTarget();

function fixture(t) {
  const scene = new THREE.Scene();
  const { camera, follow, resize } = createIsometricCamera();
  resize(800, 600);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(32, 32), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const character = new THREE.Group();
  scene.add(character);
  const canvas = new FakeElement();
  const view = new FakeView();
  let controls;
  const interactions = createInteractionController({
    character, camera, canvas, view, onInteract: () => controls.cancelTarget(),
  });
  controls = createCharacterControls({
    character, camera, canvas, ground, groundSize: 32, groundHeight: 0, characterRadius: 0.4,
    onPointerDown: interactions.handlePointerDown,
  });
  t.after(() => { controls.dispose(); interactions.dispose(); });

  function target(id, x, z, range = 1.2) {
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.6), new THREE.MeshBasicMaterial());
    mesh.position.y = 0.5;
    root.add(mesh);
    scene.add(root);
    const calls = [];
    const interactable = { id, object: root, label: id, range, interact: () => { calls.push(id); return `Used ${id}`; } };
    const unregister = interactions.register(interactable);
    return { root, mesh, calls, interactable, unregister };
  }

  function key(type, code, options = {}) {
    const { target: eventTarget, ...properties } = options;
    const event = Object.assign(new Event(type, { cancelable: true }), { code, ...properties });
    if (eventTarget) Object.defineProperty(event, 'target', { value: eventTarget });
    window.dispatchEvent(event);
    return event;
  }

  function clickWorld(point) {
    camera.updateMatrixWorld();
    const projected = point.clone().project(camera);
    const rect = canvas.getBoundingClientRect();
    const event = Object.assign(new Event('pointerdown', { cancelable: true }), {
      isPrimary: true, button: 0,
      clientX: rect.left + (projected.x + 1) * rect.width / 2,
      clientY: rect.top + (1 - projected.y) * rect.height / 2,
    });
    canvas.dispatchEvent(event);
    return event;
  }

  function step(seconds) {
    controls.update(seconds);
    follow(character.position);
    interactions.update();
  }

  return { scene, camera, character, view, interactions, controls, target, key, clickWorld, step };
}

test('registry uses horizontal world distance, availability, stable ties and safe unregistration', () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group();
  parent.position.set(5, 10, -3);
  const character = new THREE.Group();
  parent.add(character);
  scene.add(parent);
  const registry = createInteractionRegistry(character);
  let available = true;
  const a = { id: 'a', object: new THREE.Group(), label: 'A', range: 1, isAvailable: () => available, interact() {} };
  const b = { id: 'b', object: new THREE.Group(), label: 'B', range: 1, interact() {} };
  a.object.position.set(6, -100, -3);
  b.object.position.set(4, 100, -3);
  scene.add(a.object, b.object);
  const unregisterA = registry.register(a);
  registry.register(b);
  assert.equal(registry.nearest(), a); // Exactly on the boundary; first registration wins a tie.
  available = false;
  assert.equal(registry.nearest(), b);
  b.object.position.x = 3.99;
  assert.equal(registry.nearest(), undefined);
  assert.equal(registry.interact(a).performed, false);
  assert.throws(() => registry.register({ ...a, id: 'invalid', range: Infinity }), RangeError);
  assert.throws(() => registry.register(b), /Duplicate/);

  unregisterA();
  const replacement = { ...a, isAvailable: () => true };
  registry.register(replacement);
  unregisterA(); // Old cleanup must not remove its replacement.
  assert.equal(registry.nearest(), replacement);
});

test('crossing range only displays a prompt; holding E cannot trigger on entry or repeat', (t) => {
  const { character, view, interactions, target, key } = fixture(t);
  const chicken = target('chicken', 0, 0, 1);
  character.position.set(-2, 0, 0);
  interactions.update();
  assert.equal(view.shown, undefined);
  key('keydown', 'KeyE');
  character.position.x = -0.5;
  interactions.update();
  assert.equal(view.shown.interactable.id, 'chicken');
  key('keydown', 'KeyE', { repeat: true });
  key('keydown', 'KeyE');
  assert.equal(chicken.calls.length, 0);
  key('keyup', 'KeyE');
  assert.equal(key('keydown', 'KeyE').defaultPrevented, true);
  key('keydown', 'KeyE', { repeat: true });
  key('keydown', 'KeyE');
  assert.equal(chicken.calls.length, 1);
  key('keyup', 'KeyE');
  character.position.x = 2;
  interactions.update();
  assert.equal(view.shown, undefined);
  assert.equal(chicken.calls.length, 1);
});

test('E ignores text entry, modifiers and IME input, and blur releases a held key', (t) => {
  const { target, key } = fixture(t);
  const chicken = target('chicken', 0.5, 0);
  for (const options of [
    { target: new FakeElement('INPUT') }, { target: new FakeElement('TEXTAREA') },
    { target: Object.assign(new FakeElement('DIV'), { isContentEditable: true }) },
    { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true },
  ]) {
    assert.equal(key('keydown', 'KeyE', options).defaultPrevented, false);
  }
  assert.equal(chicken.calls.length, 0);
  key('keydown', 'KeyE');
  assert.equal(chicken.calls.length, 1);
  window.dispatchEvent(new Event('blur'));
  key('keydown', 'KeyE');
  assert.equal(chicken.calls.length, 2);
});

test('the prompt targets the nearest action and rechecks range and registration on click', (t) => {
  const { character, view, interactions, target } = fixture(t);
  const near = target('near', 0.5, 0);
  const farther = target('farther', -0.9, 0);
  interactions.update();
  assert.equal(view.shown.interactable.id, 'near');
  view.click();
  assert.deepEqual(near.calls, ['near']);
  assert.deepEqual(view.messages, ['Used near']);
  character.position.set(4, 0, 0); // Click before the next render cannot use a stale prompt.
  view.click();
  assert.deepEqual(near.calls, ['near']);
  assert.equal(view.shown, undefined);
  character.position.set(0, 0, 0);
  interactions.update();
  near.unregister();
  view.click();
  assert.deepEqual(near.calls, ['near']);
  assert.equal(view.shown.interactable.id, 'farther');
  view.click();
  assert.deepEqual(farther.calls, ['farther']);
});

test('an out-of-range object click walks normally and never auto-activates on arrival', (t) => {
  const { character, view, interactions, target, clickWorld, step } = fixture(t);
  const chicken = target('chicken', 2, 0, 1);
  interactions.update();
  const firstClick = clickWorld(new THREE.Vector3(2, 0.5, 0));
  assert.equal(firstClick.defaultPrevented, false);
  let sawPrompt = false;
  for (let i = 0; i < 50; i++) {
    step(0.02);
    sawPrompt ||= view.shown?.interactable.id === 'chicken';
  }
  assert.ok(sawPrompt);
  assert.deepEqual(chicken.calls, []);
  assert.ok(Math.hypot(character.position.x - 2, character.position.z) < 1);
  const secondClick = clickWorld(new THREE.Vector3(2, 0.5, 0));
  assert.equal(secondClick.defaultPrevented, true);
  assert.deepEqual(chicken.calls, ['chicken']);
  const stopped = character.position.clone();
  step(1);
  assert.ok(character.position.distanceTo(stopped) < 1e-6);

  // A deliberate ground click near the chicken still walks, without interacting.
  const groundClick = clickWorld(new THREE.Vector3(-1, 0, 2));
  assert.equal(groundClick.defaultPrevented, false);
  step(0.5);
  assert.ok(character.position.distanceTo(stopped) > 0.5);
  assert.deepEqual(chicken.calls, ['chicken']);
});

test('clicking a different nearby object selects the object actually clicked', (t) => {
  const { view, interactions, target, clickWorld } = fixture(t);
  const nearer = target('nearer', 0.35, -0.35, 1.8);
  const clicked = target('clicked', -1, 1, 1.8);
  interactions.update();
  assert.equal(view.shown.interactable.id, 'nearer');
  assert.equal(clickWorld(new THREE.Vector3(-1, 0.5, 1)).defaultPrevented, true);
  assert.deepEqual(nearer.calls, []);
  assert.deepEqual(clicked.calls, ['clicked']);
});

test('interacting cancels click-to-move without cancelling held WASD', (t) => {
  const { character, target, key, clickWorld, step } = fixture(t);
  const chicken = target('chicken', 0.5, 0, 3);
  clickWorld(new THREE.Vector3(-4, 0, 0));
  step(0.2);
  key('keydown', 'KeyE');
  key('keyup', 'KeyE');
  const stopped = character.position.clone();
  step(0.5);
  assert.ok(character.position.distanceTo(stopped) < 1e-6);
  assert.deepEqual(chicken.calls, ['chicken']);

  key('keydown', 'KeyD');
  step(0.1);
  const walking = character.position.clone();
  assert.equal(clickWorld(new THREE.Vector3(0.5, 0.5, 0)).defaultPrevented, true);
  step(0.2);
  key('keyup', 'KeyD');
  assert.ok(character.position.distanceTo(walking) > 0.5);
  assert.deepEqual(chicken.calls, ['chicken', 'chicken']);
});

test('decorative click-excluded ground shapes do not turn ground clicks into interactions', (t) => {
  const { character, target, clickWorld, step } = fixture(t);
  const chicken = target('chicken', 0.5, 0, 3);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2, 20), new THREE.MeshBasicMaterial());
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  chicken.root.add(shadow);
  chicken.interactable.clickTargets = [chicken.mesh];
  const start = character.position.clone();
  assert.equal(clickWorld(new THREE.Vector3(0, 0, 1)).defaultPrevented, false);
  step(0.2);
  assert.ok(character.position.distanceTo(start) > 0.5);
  assert.deepEqual(chicken.calls, []);
});

test('disposing interaction controls removes both keyboard and prompt activation', (t) => {
  const { view, interactions, target, key } = fixture(t);
  const chicken = target('chicken', 0.5, 0);
  interactions.update();
  interactions.dispose();
  key('keydown', 'KeyE');
  view.click();
  assert.equal(view.shown, undefined);
  assert.deepEqual(chicken.calls, []);
});
