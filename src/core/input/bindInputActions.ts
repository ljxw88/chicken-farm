import type { InputActions } from './actions';

/** Observe input without preventing, stopping, or replacing the legacy handlers. */
export function bindInputActions(actions: InputActions, target: Window, canvas: HTMLCanvasElement) {
  // Capture observes the event before the existing placement/character handlers
  // call preventDefault. It never consumes the event itself.
  target.addEventListener('keydown', actions.keyDown, true);
  target.addEventListener('keyup', actions.keyUp, true);
  target.addEventListener('click', actions.activate, true);
  target.addEventListener('blur', actions.blur);
  canvas.addEventListener('pointermove', actions.pointerMove, true);
  canvas.addEventListener('pointerdown', actions.pointerDown, true);

  return () => {
    target.removeEventListener('keydown', actions.keyDown, true);
    target.removeEventListener('keyup', actions.keyUp, true);
    target.removeEventListener('click', actions.activate, true);
    target.removeEventListener('blur', actions.blur);
    canvas.removeEventListener('pointermove', actions.pointerMove, true);
    canvas.removeEventListener('pointerdown', actions.pointerDown, true);
    actions.reset();
  };
}
