import * as THREE from 'three';
import { createBeehives } from './createBeehives';
import { createFlowerPatches } from './createFlowerPatches';

export function createGardenDressing(scene: THREE.Scene) {
  const hives = createBeehives(scene);
  const flowers = createFlowerPatches(scene);
  return {
    obstacles: hives.obstacles,
    clickTargets: hives.clickTargets,
    updateShadows(awayX: number, awayZ: number, offset: number, strength: number) {
      hives.updateShadows(awayX, awayZ, offset, strength);
      flowers.updateShadows(awayX, awayZ, offset, strength);
    },
  };
}
