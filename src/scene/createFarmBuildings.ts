import * as THREE from 'three';
import { createCottage } from './createCottage';
import { createRampCoop } from './createRampCoop';
import { createBuildingMaterials } from './farmBuildingMaterials';
import { FARM_BUILDINGS } from './farmBuildingSpecs';

export { FARM_BUILDINGS } from './farmBuildingSpecs';

export function createFarmBuildings(parent: THREE.Group) {
  const materials = createBuildingMaterials();
  const [cottageSpec, ...coopSpecs] = FARM_BUILDINGS;
  const cottage = createCottage(parent, cottageSpec, materials);
  const coops = coopSpecs.map((spec) => createRampCoop(parent, spec, materials));
  return {
    windows: cottage.windows,
    extraEmissives: [...cottage.extraEmissives, ...coops.flatMap((coop) => coop.extraEmissives)],
    clickTargets: [cottage.group, ...coops.map((coop) => coop.group)],
    obstacles: [cottage.obstacle, ...coops.flatMap((coop) => coop.obstacles)],
    splashExclusions: [cottage.splashExclusion, ...coops.map((coop) => coop.splashExclusion)],
  };
}
