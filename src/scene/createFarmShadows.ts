import * as THREE from 'three';
import { GROUND_HEIGHT, GROUND_SIZE } from './createIsland';
import { FARM_BUILDINGS } from '../content/buildings';
import { WATER_FEATURE } from '../content/waterFeature';
import { ART_SLOTS } from '../content/slots';
import { FARM_LAYOUT } from '../content/farm';
import { TREE_GEOMETRY } from '../content/propGeometry';
import { CHICKEN_GEOMETRY } from '../content/decorationGeometry';
import { FARM_SHADOW_GEOMETRY as SHADOW } from '../content/lightGeometry';

// The farm uses intentionally soft, pixel-stable ground blobs rather than
// shadow maps. The tree/chicken contacts are existing meshes; buildings get
// a matching flat footprint without changing their geometry or materials.
export function createFarmShadows(scene: THREE.Scene) {
  const trees = Array.from({ length: FARM_LAYOUT.trees.length }, (_, index) => {
    const tree = scene.getObjectByName(`farm-tree-${index + 1}`);
    const shadow = scene.getObjectByName(`farm-tree-shadow-${index + 1}`);
    return tree && shadow instanceof THREE.Mesh ? { tree, shadow } : undefined;
  }).filter((entry) => entry !== undefined);
  const chicken = scene.getObjectByName('farm-chicken');
  const chickenShadow = scene.getObjectByName('farm-chicken-shadow');

  const buildingShadows = new THREE.Group();
  buildingShadows.name = 'farm-building-shadows';
  const geometry = new THREE.CircleGeometry(...SHADOW.unitCircle);
  const material = new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true,
    opacity: ART_SLOTS.light.contact.buildingOpacity, depthWrite: false });
  const buildings = FARM_BUILDINGS.map((spec) => {
    const shadow = new THREE.Mesh(geometry, material);
    shadow.name = `${spec.name}-shadow`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(spec.width * SHADOW.footprintScale, spec.depth * SHADOW.footprintScale, 1);
    // Above the path and grass, below any visible building parts.
    shadow.position.set(spec.x, GROUND_HEIGHT + SHADOW.buildingLift, spec.z);
    buildingShadows.add(shadow);
    return { spec, shadow };
  });
  const bridge = new THREE.Mesh(geometry, material);
  bridge.name = 'wooden-bridge-shadow';
  bridge.rotation.x = -Math.PI / 2;
  bridge.scale.set(WATER_FEATURE.bridge.length * SHADOW.footprintScale, WATER_FEATURE.bridge.width * SHADOW.footprintScale, 1);
  bridge.position.set(WATER_FEATURE.bridge.x, GROUND_HEIGHT + SHADOW.waterLift, WATER_FEATURE.bridge.z);
  buildingShadows.add(bridge);

  const waterfall = new THREE.Mesh(geometry, material);
  waterfall.name = 'waterfall-lip-shadow';
  waterfall.rotation.x = -Math.PI / 2;
  // Keep the entire blob on the island side of the +Z lip, not on the void.
  waterfall.position.set(WATER_FEATURE.waterfall.x, GROUND_HEIGHT + SHADOW.waterLift, GROUND_SIZE / 2 - SHADOW.waterfallInset);
  waterfall.scale.set(WATER_FEATURE.waterfall.width / 2 + SHADOW.waterfallExtraWidth, SHADOW.waterfallInset, 1);
  buildingShadows.add(waterfall);
  scene.add(buildingShadows);

  function update(awayX: number, awayZ: number, offset: number, strength: number) {
    const rotation = Math.atan2(-awayZ, awayX);
    for (const { tree, shadow } of trees) {
      const distance = offset * SHADOW.treeOffsetFactor;
      // Tree groups are uniformly scaled; use world-sized offsets so every
      // tree follows the same sun rather than stretching with its scale.
      const treeScale = tree.scale.x;
      shadow.position.x = awayX * distance / treeScale;
      shadow.position.z = awayZ * distance / treeScale;
      shadow.rotation.z = rotation;
      // Keep the silhouette touching the trunk when the low sun moves it out.
      shadow.scale.x = Math.max(1, (distance + SHADOW.treeTouchRadius * treeScale) / (TREE_GEOMETRY.shadowRadius * treeScale));
      if (shadow.material instanceof THREE.MeshBasicMaterial) shadow.material.opacity = ART_SLOTS.light.contact.treeOpacity * strength;
    }
    if (chicken && chickenShadow instanceof THREE.Mesh) {
      const distance = offset * SHADOW.chickenOffsetFactor;
      chickenShadow.position.x = chicken.position.x + awayX * distance;
      chickenShadow.position.z = chicken.position.z + awayZ * distance;
      chickenShadow.rotation.z = rotation;
      chickenShadow.scale.x = Math.max(1, (distance + SHADOW.chickenTouchRadius) / CHICKEN_GEOMETRY.shadowRadius);
      if (chickenShadow.material instanceof THREE.MeshBasicMaterial) chickenShadow.material.opacity = ART_SLOTS.light.contact.chickenOpacity * strength;
    }
    for (const { spec, shadow } of buildings) {
      const distance = offset * (spec.name === 'cottage' ? SHADOW.cottageOffsetFactor : SHADOW.otherOffsetFactor);
      shadow.position.x = spec.x + awayX * distance;
      shadow.position.z = spec.z + awayZ * distance;
    }
    const bridgeDistance = offset * SHADOW.otherOffsetFactor;
    bridge.position.x = WATER_FEATURE.bridge.x + awayX * bridgeDistance;
    bridge.position.z = WATER_FEATURE.bridge.z + awayZ * bridgeDistance;
    const waterfallDistance = offset * SHADOW.otherOffsetFactor;
    waterfall.position.x = WATER_FEATURE.waterfall.x + awayX * waterfallDistance;
    waterfall.position.z = GROUND_SIZE / 2 - SHADOW.waterfallInset + awayZ * waterfallDistance;
    // Expand back toward the lip as the offset grows so the shadow remains
    // attached, while its +Z edge never projects beyond the island rim.
    waterfall.scale.y = SHADOW.waterfallInset + Math.max(0, -awayZ * waterfallDistance);
    const lipX = WATER_FEATURE.waterfall.x;
    const lipZ = GROUND_SIZE / 2 - WATER_FEATURE.waterfall.lipDepth / 2;
    const zFraction = Math.min(Math.abs(lipZ - waterfall.position.z) / waterfall.scale.y, 1 - 1e-9);
    const widthToTouchLip = Math.abs(lipX - waterfall.position.x) / Math.sqrt(1 - zFraction * zFraction);
    waterfall.scale.x = Math.max(WATER_FEATURE.waterfall.width / 2 + SHADOW.waterfallExtraWidth + Math.max(0, awayX * waterfallDistance),
      widthToTouchLip + SHADOW.waterfallTouchMargin);
    material.opacity = ART_SLOTS.light.contact.buildingOpacity * strength;
  }

  return { update };
}
