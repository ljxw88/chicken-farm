export type PlacementKind = 'fence' | 'plot';
export type PointerPoint = { x: number; y: number; pointerType: string };
export type MoveAction = { type: 'move'; right: number; forward: number; active: boolean };
export type InputAction =
  | { type: 'move-to'; point: PointerPoint }
  | { type: 'cancel-move-to' }
  | { type: 'placement-select'; kind: PlacementKind }
  | { type: 'placement-preview'; point: PointerPoint }
  | { type: 'placement-rotate' }
  | { type: 'placement-confirm' }
  | { type: 'placement-remove'; mode: 'toggle' | 'hovered' }
  | { type: 'placement-undo' }
  | { type: 'placement-cancel' };
export type MovementAction = Extract<InputAction, { type: 'move-to' | 'cancel-move-to' }>;

export type InputFrame = {
  move: MoveAction;
  pointer: PointerPoint | undefined;
  actions: readonly InputAction[];
};

export type PlacementInputContext = { active: boolean; removing: boolean };

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

function element(target: EventTarget | null): HTMLElement | undefined {
  return target && 'tagName' in target ? target as HTMLElement : undefined;
}

function editable(target: EventTarget | null) {
  const node = element(target);
  return Boolean(node && (node.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)));
}

function modified(event: KeyboardEvent) {
  return event.altKey || event.ctrlKey || event.metaKey;
}

/** Maps browser events to actions; one-shots are retained until a simulation tick consumes them. */
export function createInputActions(getPlacement: () => PlacementInputContext = () => ({ active: false, removing: false })) {
  const held = new Set<string>();
  const discreteHeld = new Set<string>();
  let pending: InputAction[] = [];
  let pointer: PointerPoint | undefined;
  const movementListeners = new Set<(action: MovementAction) => void>();

  function notifyMovement(action: MovementAction) {
    for (const listener of movementListeners) listener(action);
  }

  function enqueue(action: InputAction) {
    pending.push(action);
    // The legacy placement controller cancels an outstanding walk target when
    // a tool first becomes active, but not when switching active tools.
    if (action.type === 'placement-select' && !getPlacement().active) pending.push({ type: 'cancel-move-to' });
  }

  function keyDown(event: KeyboardEvent) {
    if (modified(event) || editable(event.target)) return;
    if (MOVEMENT_KEYS.has(event.code)) {
      if (!held.has(event.code)) pending.push({ type: 'cancel-move-to' });
      held.add(event.code);
      // The previous controller cancelled on every keydown, including repeats.
      notifyMovement({ type: 'cancel-move-to' });
      return;
    }
    if (event.defaultPrevented || event.repeat || event.isComposing || discreteHeld.has(event.code)) return;
    const { active, removing } = getPlacement();
    const node = element(event.target);
    let action: InputAction | undefined;
    if (event.code === 'KeyF') action = { type: 'placement-select', kind: 'fence' };
    else if (event.code === 'KeyP') action = { type: 'placement-select', kind: 'plot' };
    else if (event.code === 'KeyZ') action = { type: 'placement-undo' };
    else if (active && event.code === 'KeyR' && !removing) action = { type: 'placement-rotate' };
    else if (active && event.code === 'Delete') action = { type: 'placement-remove', mode: 'hovered' };
    else if (active && event.code === 'Escape') action = { type: 'placement-cancel' };
    else if (active && !removing && event.code === 'Enter' &&
      !(node && (['BUTTON', 'A'].includes(node.tagName) || node.closest('.placement-controls')))) {
      action = { type: 'placement-confirm' };
    }
    if (action) {
      discreteHeld.add(event.code);
      enqueue(action);
    }
  }

  function keyUp(event: KeyboardEvent) {
    // Key-up must work even if focus or modifiers changed while the key was down.
    held.delete(event.code);
    discreteHeld.delete(event.code);
  }

  function blur() {
    held.clear();
    discreteHeld.clear();
    pending.push({ type: 'cancel-move-to' });
    notifyMovement({ type: 'cancel-move-to' });
  }

  function point(event: PointerEvent): PointerPoint {
    return { x: event.clientX, y: event.clientY, pointerType: event.pointerType || 'mouse' };
  }

  function pointerMove(event: PointerEvent) {
    if (!event.isPrimary) return;
    pointer = point(event);
    if (getPlacement().active) pending.push({ type: 'placement-preview', point: pointer });
  }

  function pointerDown(event: PointerEvent, movementBlocked = false, context = getPlacement()) {
    if (!event.isPrimary || event.button !== 0) return;
    if (context.active) {
      // Placement wins over click-to-move. Touch/pen preview without placing.
      pointer = point(event);
      pending.push({ type: 'placement-preview', point: pointer });
      if (context.removing) pending.push({ type: 'placement-remove', mode: 'hovered' });
      else if (!event.pointerType || event.pointerType === 'mouse') pending.push({ type: 'placement-confirm' });
    } else if (held.size === 0 && !movementBlocked) {
      pointer = point(event);
      const action: MovementAction = { type: 'move-to', point: pointer };
      pending.push(action);
      // Resolve the raycast at pointer-event time, as the old controller did.
      notifyMovement(action);
    }
  }

  function activate(event: MouseEvent) {
    const node = element(event.target);
    const button = node?.closest<HTMLButtonElement>('.placement-controls button');
    if (!button || button.disabled) return;
    let action: InputAction | undefined;
    if (button.hasAttribute('data-fence')) action = { type: 'placement-select', kind: 'fence' };
    else if (button.hasAttribute('data-plot')) action = { type: 'placement-select', kind: 'plot' };
    else if (button.hasAttribute('data-rotate')) action = { type: 'placement-rotate' };
    else if (button.hasAttribute('data-confirm')) action = { type: 'placement-confirm' };
    else if (button.hasAttribute('data-remove')) action = { type: 'placement-remove', mode: 'toggle' };
    else if (button.hasAttribute('data-undo')) action = { type: 'placement-undo' };
    else if (button.hasAttribute('data-cancel')) action = { type: 'placement-cancel' };
    if (action) enqueue(action);
  }

  function movement(): MoveAction {
    return {
      type: 'move', right: Number(held.has('KeyD')) - Number(held.has('KeyA')),
      forward: Number(held.has('KeyW')) - Number(held.has('KeyS')), active: held.size > 0,
    };
  }

  function consume(): InputFrame {
    const actions = pending;
    pending = [];
    return {
      move: movement(),
      pointer: pointer && { ...pointer },
      actions,
    };
  }

  function reset() {
    held.clear();
    discreteHeld.clear();
    pending = [];
    pointer = undefined;
  }

  function onMovement(listener: (action: MovementAction) => void) {
    movementListeners.add(listener);
    return () => movementListeners.delete(listener);
  }

  function preventMovementDefault(event: KeyboardEvent) {
    if (MOVEMENT_KEYS.has(event.code) && !modified(event) && !editable(event.target)) event.preventDefault();
  }

  return { keyDown, keyUp, blur, pointerMove, pointerDown, activate, movement, onMovement, preventMovementDefault,
    placementContext: getPlacement, consume, reset };
}

export type InputActions = ReturnType<typeof createInputActions>;
