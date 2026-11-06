import * as THREE from 'three';
import type { Interactable } from './Interactable';
import { createInteractionRegistry } from './createInteractionRegistry';

export interface InteractionView {
  show(interactable: Interactable, screenX: number, screenY: number): void;
  hide(): void;
  showMessage(message: string): void;
  onActivate(callback: () => void): () => void;
}

interface InteractionControllerOptions {
  character: THREE.Object3D;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  view: InteractionView;
  onInteract?: () => void;
  isEnabled?: () => boolean;
}

export function createInteractionController({
  character, camera, canvas, view, onInteract, isEnabled = () => true,
}: InteractionControllerOptions) {
  const registry = createInteractionRegistry(character);
  const anchor = new THREE.Vector3();
  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let current: Interactable | undefined;
  let interactKeyHeld = false;

  function update() {
    if (!isEnabled()) {
      current = undefined;
      view.hide();
      return;
    }
    current = registry.nearest();
    const rect = canvas.getBoundingClientRect();
    if (!current || rect.width === 0 || rect.height === 0) {
      view.hide();
      return;
    }

    current.object.getWorldPosition(anchor);
    anchor.y += current.promptHeight ?? 1;
    camera.updateMatrixWorld();
    anchor.project(camera);
    if (anchor.z < -1 || anchor.z > 1) {
      view.hide();
      return;
    }
    view.show(current, rect.left + (anchor.x + 1) * rect.width / 2, rect.top + (1 - anchor.y) * rect.height / 2);
  }

  function activate(interactable: Interactable | undefined) {
    if (!isEnabled()) {
      update();
      return false;
    }
    const result = registry.interact(interactable);
    if (result.performed) {
      onInteract?.();
      if (result.message) view.showMessage(result.message);
    }
    // An action can remove the target or change which action is available.
    update();
    return result.performed;
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!isEnabled() || event.code !== 'KeyE' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
      event.isComposing || event.repeat || interactKeyHeld) return;
    const element = event.target;
    if (element instanceof HTMLElement &&
      (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))) return;

    interactKeyHeld = true;
    if (activate(registry.nearest())) event.preventDefault();
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.code === 'KeyE') interactKeyHeld = false;
  }

  function handleBlur() {
    interactKeyHeld = false;
  }

  // Called by click-to-move before it handles the same pointer event. Only an
  // explicit hit on an in-range object consumes the click; reaching its range
  // after a ground click never queues or automatically performs an action.
  function handlePointerDown(event: PointerEvent) {
    if (!isEnabled() || event.defaultPrevented || !event.isPrimary || event.button !== 0) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const roots = new Map<THREE.Object3D, Interactable>();
    for (const interactable of registry.available()) {
      for (const root of interactable.clickTargets ?? [interactable.object]) {
        root.updateWorldMatrix(true, true);
        roots.set(root, interactable);
      }
    }
    if (roots.size === 0) return false;

    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects([...roots.keys()], true)[0];
    if (!hit) return false;
    let object: THREE.Object3D | null = hit.object;
    while (object && !roots.has(object)) object = object.parent;
    const handled = activate(object ? roots.get(object) : undefined);
    if (handled) event.preventDefault();
    return handled;
  }

  const unsubscribe = view.onActivate(() => activate(current));
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);

  function dispose() {
    unsubscribe();
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('blur', handleBlur);
    interactKeyHeld = false;
    current = undefined;
    view.hide();
  }

  return { register: registry.register, update, handlePointerDown, dispose };
}
