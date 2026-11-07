import * as THREE from 'three';
import { createBuildingMaterials } from './farmBuildingMaterials';
import { FARM_BUILDINGS, type CottageSpec, type CoopSpec } from '../content/buildings';
import { ART_SLOTS, type BuildingSlots } from '../content/slots';
import { BUILDING_ASSETS } from '../render/buildingAssets';

export function createFarmBuildings(parent: THREE.Group,
  specs: readonly [CottageSpec, ...CoopSpec[]] = FARM_BUILDINGS, slots: BuildingSlots = ART_SLOTS.building) {
  const materials = createBuildingMaterials(slots);
  const [cottageSpec, ...coopSpecs] = specs;
  const cottage = BUILDING_ASSETS[cottageSpec.assetId](parent, cottageSpec, materials, slots);
  const coops = coopSpecs.map((spec) => BUILDING_ASSETS[spec.assetId](parent, spec, materials, slots));
  return {
    windows: cottage.windows,
    extraEmissives: [...cottage.extraEmissives, ...coops.flatMap((coop) => coop.extraEmissives)],
    obstacles: [cottage.obstacle, ...coops.flatMap((coop) => coop.obstacles)],
    splashExclusions: [cottage.splashExclusion, ...coops.map((coop) => coop.splashExclusion)],
  };
}
