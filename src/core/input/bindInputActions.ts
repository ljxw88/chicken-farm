import type { InputActions } from './actions';

export interface InputBindingOptions {
  ownMovement?: boolean;
  ownPlacement?: boolean;
  onPointerDown?: (event: PointerEvent) => boolean;
}

/** Placement actions run at event time; movement still sees the pointer second. */
export function bindInputActions(actions: InputActions, target: Window, canvas: HTMLCanvasElement,
  options: InputBindingOptions = {}) {
  const capture = { capture: true };
  const keyDown = (event: KeyboardEvent) => actions.keyDown(event, options.ownPlacement);
  target.addEventListener('keydown', keyDown, capture);
  // Match the old window-level placement handler: target handlers may first
  // prevent a shortcut, while held movement continues to be captured.
  if (options.ownPlacement) target.addEventListener('keydown', actions.placementKeyDown);
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
    target.addEventListener('keydown', actions.preventMovementDefault);
    canvas.addEventListener('pointerdown', handlePointerDown);
  } else {
    canvas.addEventListener('pointerdown', actions.pointerDown, capture);
  }

  return () => {
    target.removeEventListener('keydown', keyDown, capture);
    if (options.ownPlacement) target.removeEventListener('keydown', actions.placementKeyDown);
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
