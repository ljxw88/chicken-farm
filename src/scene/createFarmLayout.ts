import * as THREE from 'three';
import type { FarmObstacle } from '../character/farmCollisions';
import { FARM_LAYOUT, type FarmLayout } from '../content/farm';
import { POND_GEOMETRY, TREE_GEOMETRY } from '../content/propGeometry';
import type { CrownSlots } from '../content/slots';
import { FARM_PROP_ASSETS } from '../render/farmProps';
import { createFarmBuildings } from './createFarmBuildings';

export function createFarmLayout(scene: THREE.Scene, layout: FarmLayout = FARM_LAYOUT, crown?: CrownSlots) {
  const group = new THREE.Group();
  group.name = 'farm-layout';
  scene.add(group);
  FARM_PROP_ASSETS[layout.path.assetId](group, layout.path);
  const { windows, extraEmissives, clickTargets, obstacles: buildingObstacles, splashExclusions: buildingShelters } = createFarmBuildings(group);
  FARM_PROP_ASSETS[layout.treeAssetId](group, layout.trees, crown);
  FARM_PROP_ASSETS[layout.pond.assetId](group, layout.pond);
  const water = FARM_PROP_ASSETS[layout.waterAssetId](group);
  FARM_PROP_ASSETS[layout.grass.assetId](group, layout.grass, water.curve);

  const { trees, pond } = layout;
  const pondObstacle: FarmObstacle = {
    // The 5% margin covers the irregular water outline without blocking its whole oval rim.
    kind: 'box', name: 'pond', minX: pond.x - pond.waterWidth * POND_GEOMETRY.collisionMarginFactor,
    maxX: pond.x + pond.waterWidth * POND_GEOMETRY.collisionMarginFactor,
    minZ: pond.z - pond.waterDepth * POND_GEOMETRY.collisionMarginFactor,
    maxZ: pond.z + pond.waterDepth * POND_GEOMETRY.collisionMarginFactor,
  };
  const obstacles: FarmObstacle[] = [
    ...buildingObstacles,
    ...trees.map(({ x, z, scale }, index): FarmObstacle => ({
      kind: 'circle', name: `tree-${index + 1}`, x, z, radius: TREE_GEOMETRY.collisionRadius * scale,
    })),
    pondObstacle,
    ...water.obstacles,
  ];
  const splashExclusions: FarmObstacle[] = [
    ...buildingShelters,
    // Shelter beneath the tree crowns and keep the pond's existing ripples uncluttered.
    ...trees.map(({ x, z, scale }, index): FarmObstacle => ({
      kind: 'circle', name: `tree-canopy-${index + 1}`, x, z, radius: TREE_GEOMETRY.shelterRadius * scale,
    })),
    pondObstacle,
    ...water.splashExclusions,
  ];
  return { windows, extraEmissives, clickTargets, obstacles, splashExclusions,
    bridgeHeight: water.bridgeHeight, updateWaterfall: water.updateWaterfall };
}
