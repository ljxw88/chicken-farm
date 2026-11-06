import type { InputActions } from './actions';

export interface InputBindingOptions {
  // Placement is still a synchronous legacy handler and must see the pointer first.
  ownMovement?: boolean;
  onPointerDown?: (event: PointerEvent) => boolean;
}

/** Bind the action mapper; unported placement handlers retain their original priority. */
export function bindInputActions(actions: InputActions, target: Window, canvas: HTMLCanvasElement,
  options: InputBindingOptions = {}) {
  // Capture observes the event before the existing placement/character handlers
  // call preventDefault. It never consumes the event itself.
  const capture = { capture: true };
  target.addEventListener('keydown', actions.keyDown, capture);
  target.addEventListener('keyup', actions.keyUp, capture);
  target.addEventListener('click', actions.activate, capture);
  target.addEventListener('blur', actions.blur);
  canvas.addEventListener('pointermove', actions.pointerMove, capture);
  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    // Record the context from before synchronous placement can remove an item
    // and leave removal mode, matching the original capture-time action map.
    const context = { ...actions.placementContext() };
    const handled = options.onPointerDown?.(event) ?? false;
    actions.pointerDown(event, handled, context);
  };
  if (options.ownMovement) {
    // At bubble time this follows the placement key handler, just as the old
    // walking handler did. Capture above still records placement actions.
    target.addEventListener('keydown', actions.preventMovementDefault);
    canvas.addEventListener('pointerdown', handlePointerDown);
  } else {
    canvas.addEventListener('pointerdown', actions.pointerDown, capture);
  }

  return () => {
    target.removeEventListener('keydown', actions.keyDown, capture);
    target.removeEventListener('keyup', actions.keyUp, capture);
    target.removeEventListener('click', actions.activate, capture);
    target.removeEventListener('blur', actions.blur);
    canvas.removeEventListener('pointermove', actions.pointerMove, capture);
    if (options.ownMovement) {
      target.removeEventListener('keydown', actions.preventMovementDefault);
      canvas.removeEventListener('pointerdown', handlePointerDown);
    } else {
      canvas.removeEventListener('pointerdown', actions.pointerDown, capture);
    }
    actions.reset();
  };
}
