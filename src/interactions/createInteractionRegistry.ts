import * as THREE from 'three';
import type { Interactable } from './Interactable';

export function createInteractionRegistry(character: THREE.Object3D) {
  const entries = new Map<string, Interactable>();
  const characterPosition = new THREE.Vector3();
  const objectPosition = new THREE.Vector3();

  function register(interactable: Interactable) {
    if (!interactable.id.trim()) throw new Error('An interactable needs an id');
    if (!Number.isFinite(interactable.range) || interactable.range <= 0) {
      throw new RangeError('An interactable needs a finite, positive range');
    }
    if (entries.has(interactable.id)) throw new Error(`Duplicate interactable: ${interactable.id}`);
    entries.set(interactable.id, interactable);
    return () => {
      // A stale disposer must not unregister a newer object using the same id.
      if (entries.get(interactable.id) === interactable) entries.delete(interactable.id);
    };
  }

  function isAvailable(interactable: Interactable) {
    return entries.get(interactable.id) === interactable && (interactable.isAvailable?.() ?? true);
  }

  function distanceSquared(interactable: Interactable) {
    character.getWorldPosition(characterPosition);
    interactable.object.getWorldPosition(objectPosition);
    const dx = characterPosition.x - objectPosition.x;
    const dz = characterPosition.z - objectPosition.z;
    return dx * dx + dz * dz;
  }

  function isInRange(interactable: Interactable) {
    return isAvailable(interactable) && distanceSquared(interactable) <= interactable.range ** 2;
  }

  function nearest() {
    let result: Interactable | undefined;
    let closestDistance = Infinity;
    for (const interactable of entries.values()) {
      if (!isAvailable(interactable)) continue;
      const distance = distanceSquared(interactable);
      // Registration order breaks exact ties, so the prompt cannot flicker between them.
      if (distance <= interactable.range ** 2 && distance < closestDistance) {
        result = interactable;
        closestDistance = distance;
      }
    }
    return result;
  }

  function available() {
    return [...entries.values()].filter(isAvailable);
  }

  function interact(interactable: Interactable | undefined) {
    if (!interactable || !isInRange(interactable)) return { performed: false as const };
    return { performed: true as const, message: interactable.interact() };
  }

  return { register, nearest, available, isInRange, interact };
}
