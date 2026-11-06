import type * as THREE from 'three';

/** One primary action attached to a world object. Distances are measured on the ground plane. */
export interface Interactable {
  readonly id: string;
  readonly object: THREE.Object3D;
  readonly label: string | (() => string);
  readonly range: number;
  /** World-space height above the object's origin at which to show the prompt. */
  readonly promptHeight?: number;
  /** Defaults to the whole object. An empty list disables clicking the object itself. */
  readonly clickTargets?: readonly THREE.Object3D[];
  isAvailable?(): boolean;
  /** Return optional, plain-text feedback for the player. */
  interact(): string | void;
}
