import * as THREE from 'three';
import { GARDEN_DRESSING } from '../../content/garden';
import { GARDEN_ASSETS } from '../../render/gardenAssets';

export function createGardenDressing(scene: THREE.Scene) {
  const hives = GARDEN_ASSETS[GARDEN_DRESSING.hiveAssetId](scene);
  const flowers = GARDEN_ASSETS[GARDEN_DRESSING.flowerAssetId](scene);
  return {
    obstacles: hives.obstacles,
    clickTargets: hives.clickTargets,
    updateShadows(awayX: number, awayZ: number, offset: number, strength: number) {
      hives.updateShadows(awayX, awayZ, offset, strength);
      flowers.updateShadows(awayX, awayZ, offset, strength);
    },
  };
}
