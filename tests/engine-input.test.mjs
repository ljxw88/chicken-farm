import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createInputActions } = await vite.ssrLoadModule('/src/core/input/actions.ts');
const { bindInputActions } = await vite.ssrLoadModule('/src/core/input/bindInputActions.ts');
after(() => vite.close());

function fixture(t, bindingOptions) {
  const dom = new JSDOM(`<!doctype html><body><canvas></canvas><input><textarea></textarea><select></select>
    <div contenteditable><span>edit</span></div><a href="#">link</a><div data-input-scope="ui"><button id="sky-control">Sky</button></div>
    <aside class="placement-controls"><button data-fence><span>Fence</span></button><button data-plot>Plot</button>
      <button data-rotate>Rotate</button><button data-confirm>Place</button><button data-remove>Remove</button>
      <button data-undo>Undo</button><button data-cancel>Cancel</button></aside></body>`);
  const { window } = dom;
  const { document } = window;
  const canvas = document.querySelector('canvas');
  const context = { active: false, removing: false };
  const input = createInputActions(() => context);
  const detach = bindInputActions(input, window, canvas, bindingOptions);
  t.after(() => { detach(); window.close(); });
  const key = (type, code, target = document.body, options = {}) => {
    const event = new window.KeyboardEvent(type, { bubbles: true, cancelable: true, code, ...options });
    target.dispatchEvent(event);
    return event;
  };
  const pointer = (type, pointerType = 'mouse', options = {}) => {
    const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 123, clientY: 456, ...options });
    Object.defineProperties(event, { isPrimary: { value: options.isPrimary ?? true }, pointerType: { value: pointerType } });
    canvas.dispatchEvent(event);
    return event;
  };
  return { window, document, canvas, context, input, detach, key, pointer };
}

test('WASD is a held action; a new key cancels click-to-move and blur releases it', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown');
  assert.deepEqual(f.input.consume().actions, [{ type: 'move-to', point: { x: 123, y: 456, pointerType: 'mouse' } }]);
  assert.equal(f.key('keydown', 'KeyW').defaultPrevented, false); // The legacy handler still owns the event.
  f.key('keydown', 'KeyD');
  f.key('keydown', 'KeyW', f.document.body, { repeat: true });
  const held = f.input.consume();
  assert.deepEqual(held.move, { type: 'move', right: 1, forward: 1, active: true });
  assert.deepEqual(held.actions, [{ type: 'cancel-move-to' }, { type: 'cancel-move-to' }]);
  f.pointer('pointerdown'); // Held keyboard movement takes precedence over click-to-move.
  assert.deepEqual(f.input.consume().actions, []);
  f.key('keyup', 'KeyW', f.document.querySelector('input'));
  assert.deepEqual(f.input.consume().move, { type: 'move', right: 1, forward: 0, active: true });
  f.key('keydown', 'KeyA');
  assert.deepEqual(f.input.consume().move, { type: 'move', right: 0, forward: 0, active: true });
  f.window.dispatchEvent(new f.window.Event('blur'));
  const blurred = f.input.consume();
  assert.deepEqual(blurred.move, { type: 'move', right: 0, forward: 0, active: false });
  assert.deepEqual(blurred.actions, [{ type: 'cancel-move-to' }]);
  assert.deepEqual(f.input.consume().actions, []);
});

test('owned movement resolves actions immediately, preserves placement priority and prevents WASD defaults', (t) => {
  let handled = false;
  const f = fixture(t, { ownMovement: true, onPointerDown: () => handled });
  const movements = [];
  f.input.onMovement((action) => movements.push(action));
  f.pointer('pointerdown');
  assert.deepEqual(movements, [{ type: 'move-to', point: { x: 123, y: 456, pointerType: 'mouse' } }]);
  f.pointer('pointerdown', 'mouse', { button: 2 });
  f.pointer('pointerdown', 'touch', { isPrimary: false });
  assert.equal(movements.length, 1, 'non-primary pointers must not start walking');
  assert.equal(f.key('keydown', 'KeyW').defaultPrevented, true);
  f.key('keydown', 'KeyW', f.document.body, { repeat: true });
  assert.deepEqual(movements.slice(1), [{ type: 'cancel-move-to' }, { type: 'cancel-move-to' }]);
  f.pointer('pointerdown'); // Held keys take priority, even if opposite keys cancel.
  assert.equal(movements.length, 3);
  f.key('keyup', 'KeyW', f.document.querySelector('input'));
  handled = true;
  f.pointer('pointerdown');
  assert.equal(movements.length, 3, 'a synchronous handler consumed the pointer');
  handled = false;
  f.context.active = true;
  f.pointer('pointerdown', 'touch');
  assert.equal(movements.length, 3, 'placement has priority over touch walking');
  f.window.dispatchEvent(new f.window.Event('blur'));
  assert.equal(movements.at(-1).type, 'cancel-move-to');
  assert.equal(f.key('keydown', 'KeyW', f.document.querySelector('input')).defaultPrevented, false);
});

test('owned placement pointer actions use the context before synchronous removal', (t) => {
  let context;
  const f = fixture(t, { ownMovement: true, onPointerDown: () => { context.removing = false; return true; } });
  context = f.context;
  context.active = true;
  context.removing = true;
  f.pointer('pointerdown', 'mouse');
  assert.deepEqual(f.input.consume().actions, [
    { type: 'placement-preview', point: { x: 123, y: 456, pointerType: 'mouse' } },
    { type: 'placement-remove', mode: 'hovered' },
  ]);
});

test('detaching owned and observing bindings removes every listener', () => {
  for (const ownMovement of [false, true]) {
    const target = new EventTarget();
    const canvas = new EventTarget();
    const detach = bindInputActions(createInputActions(), target, canvas, { ownMovement });
    assert.equal(getEventListeners(target, 'keydown').length, ownMovement ? 2 : 1);
    detach();
    for (const type of ['keydown', 'keyup', 'click', 'blur']) assert.equal(getEventListeners(target, type).length, 0, type);
    for (const type of ['pointermove', 'pointerdown']) assert.equal(getEventListeners(canvas, type).length, 0, type);
  }
});

test('placement keys are one-shot, ordered, repeat-safe, and consumed exactly once', (t) => {
  const f = fixture(t);
  f.key('keydown', 'KeyF');
  f.key('keydown', 'KeyF', f.document.body, { repeat: true });
  f.key('keydown', 'KeyF'); // Even a duplicate non-repeat keydown is not a second press.
  assert.deepEqual(f.input.consume().actions, [{ type: 'placement-select', kind: 'fence' }, { type: 'cancel-move-to' }]);
  assert.deepEqual(f.input.consume().actions, []);
  f.key('keyup', 'KeyF');
  f.context.active = true;
  f.key('keydown', 'KeyP');
  f.key('keydown', 'KeyR');
  f.key('keydown', 'Enter');
  f.key('keydown', 'Delete');
  f.key('keydown', 'KeyZ');
  f.key('keydown', 'Escape');
  assert.deepEqual(f.input.consume().actions, [
    { type: 'placement-select', kind: 'plot' }, { type: 'placement-rotate' }, { type: 'placement-confirm' },
    { type: 'placement-remove', mode: 'hovered' }, { type: 'placement-undo' }, { type: 'placement-cancel' },
  ]);
  assert.deepEqual(f.input.consume().actions, []);
  f.key('keyup', 'KeyF');
  f.key('keydown', 'KeyF');
  assert.deepEqual(f.input.consume().actions, [{ type: 'placement-select', kind: 'fence' }]);
});

test('editable focus, modifiers, composing, default prevention and focused buttons do not steal shortcuts', (t) => {
  const f = fixture(t);
  for (const selector of ['input', 'textarea', 'select']) {
    f.key('keydown', 'KeyW', f.document.querySelector(selector));
    f.key('keydown', 'KeyF', f.document.querySelector(selector));
  }
  const edit = f.document.querySelector('[contenteditable]');
  Object.defineProperty(edit, 'isContentEditable', { value: true });
  f.key('keydown', 'KeyF', edit);
  f.key('keydown', 'KeyF', f.document.body, { ctrlKey: true });
  f.key('keydown', 'KeyF', f.document.body, { altKey: true });
  f.key('keydown', 'KeyF', f.document.body, { metaKey: true });
  f.key('keydown', 'KeyF', f.document.body, { isComposing: true });
  const prevented = new f.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'KeyF' });
  prevented.preventDefault();
  f.document.body.dispatchEvent(prevented);
  f.context.active = true;
  f.key('keydown', 'Enter', f.document.querySelector('[data-confirm]'));
  f.key('keydown', 'Enter', f.document.querySelector('a'));
  assert.deepEqual(f.input.consume(), {
    move: { type: 'move', right: 0, forward: 0, active: false }, pointer: undefined, actions: [],
  });
});

test('focused sky controls keep game keys; the canvas still receives walking and placement', (t) => {
  const f = fixture(t, { ownMovement: true });
  const sky = f.document.querySelector('#sky-control');
  f.context.active = true;
  for (const code of ['Escape', 'Enter', 'Space', 'KeyW', 'KeyF', 'KeyP', 'KeyR', 'KeyZ']) f.key('keydown', code, sky);
  assert.deepEqual(f.input.consume().actions, []);
  assert.equal(f.input.consume().move.active, false);
  f.key('keydown', 'KeyW', f.document.body);
  assert.equal(f.input.consume().move.forward, 1);
  // Releasing a held game key still works if focus moved into the HUD.
  f.key('keyup', 'KeyW', sky);
  assert.equal(f.input.consume().move.active, false);
  f.key('keydown', 'KeyF', f.document.body);
  assert.deepEqual(f.input.consume().actions, [{ type: 'placement-select', kind: 'fence' }]);
});

test('placement takes pointer priority; mouse confirms, touch/pen preview, and UI confirms', (t) => {
  const f = fixture(t);
  f.context.active = true;
  f.pointer('pointerdown', 'touch');
  assert.deepEqual(f.input.consume().actions, [
    { type: 'placement-preview', point: { x: 123, y: 456, pointerType: 'touch' } },
  ]);
  f.pointer('pointerdown', 'pen');
  assert.deepEqual(f.input.consume().actions, [
    { type: 'placement-preview', point: { x: 123, y: 456, pointerType: 'pen' } },
  ]);
  f.document.querySelector('[data-rotate]').click();
  f.document.querySelector('[data-confirm]').click();
  assert.deepEqual(f.input.consume().actions, [{ type: 'placement-rotate' }, { type: 'placement-confirm' }]);
  f.pointer('pointerdown', 'mouse');
  assert.deepEqual(f.input.consume().actions, [
    { type: 'placement-preview', point: { x: 123, y: 456, pointerType: 'mouse' } }, { type: 'placement-confirm' },
  ]);
  f.document.querySelector('[data-remove]').click();
  f.context.removing = true;
  f.pointer('pointerdown', 'touch');
  assert.deepEqual(f.input.consume().actions, [
    { type: 'placement-remove', mode: 'toggle' },
    { type: 'placement-preview', point: { x: 123, y: 456, pointerType: 'touch' } },
    { type: 'placement-remove', mode: 'hovered' },
  ]);
  f.pointer('pointerdown', 'mouse', { button: 2 });
  f.pointer('pointerdown', 'touch', { isPrimary: false });
  assert.deepEqual(f.input.consume().actions, []);
});

test('entering placement cancels an existing move-to, but switching active tools does not', (t) => {
  const f = fixture(t);
  f.pointer('pointerdown');
  f.key('keydown', 'KeyF');
  assert.deepEqual(f.input.consume().actions, [
    { type: 'move-to', point: { x: 123, y: 456, pointerType: 'mouse' } },
    { type: 'placement-select', kind: 'fence' }, { type: 'cancel-move-to' },
  ]);
  f.context.active = true;
  f.document.querySelector('[data-plot]').click();
  assert.deepEqual(f.input.consume().actions, [{ type: 'placement-select', kind: 'plot' }]);
});

test('direct controls map every placement command without changing browser events', (t) => {
  const f = fixture(t);
  const captured = [];
  f.window.addEventListener('click', (event) => captured.push(event.defaultPrevented));
  f.document.querySelector('[data-fence] span').click();
  f.context.active = true; // The legacy selection handler activates the tool before the next click.
  for (const name of ['plot', 'rotate', 'confirm', 'remove', 'undo', 'cancel']) f.document.querySelector(`[data-${name}]`).click();
  assert.deepEqual(f.input.consume().actions, [
    { type: 'placement-select', kind: 'fence' }, { type: 'cancel-move-to' }, { type: 'placement-select', kind: 'plot' },
    { type: 'placement-rotate' }, { type: 'placement-confirm' }, { type: 'placement-remove', mode: 'toggle' },
    { type: 'placement-undo' }, { type: 'placement-cancel' },
  ]);
  assert.deepEqual(captured, Array(7).fill(false));
  f.detach();
  f.key('keydown', 'KeyF');
  assert.deepEqual(f.input.consume().actions, []);
});
