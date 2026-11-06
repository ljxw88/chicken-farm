import * as THREE from 'three';
import { GROUND_HEIGHT } from './createIsland';
import { FARM_BUILDINGS } from './farmBuildingSpecs';

// The farm uses intentionally soft, pixel-stable ground blobs rather than
// shadow maps. The tree/chicken contacts are existing meshes; buildings get
// a matching flat footprint without changing their geometry or materials.
export function createFarmShadows(scene: THREE.Scene) {
  const trees = Array.from({ length: 4 }, (_, index) => {
    const tree = scene.getObjectByName(`farm-tree-${index + 1}`);
    const shadow = scene.getObjectByName(`farm-tree-shadow-${index + 1}`);
    return tree && shadow instanceof THREE.Mesh ? { tree, shadow } : undefined;
  }).filter((entry) => entry !== undefined);
  const chicken = scene.getObjectByName('farm-chicken');
  const chickenShadow = scene.getObjectByName('farm-chicken-shadow');

  const buildingShadows = new THREE.Group();
  buildingShadows.name = 'farm-building-shadows';
  const geometry = new THREE.CircleGeometry(1, 24);
  const material = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.12, depthWrite: false });
  const buildings = FARM_BUILDINGS.map((spec) => {
    const shadow = new THREE.Mesh(geometry, material);
    shadow.name = `${spec.name}-shadow`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(spec.width * 0.55, spec.depth * 0.55, 1);
    // Above the path and grass, below any visible building parts.
    shadow.position.set(spec.x, GROUND_HEIGHT + 0.03, spec.z);
    buildingShadows.add(shadow);
    return { spec, shadow };
  });
  scene.add(buildingShadows);

  function update(awayX: number, awayZ: number, offset: number, strength: number) {
    const rotation = Math.atan2(-awayZ, awayX);
    for (const { tree, shadow } of trees) {
      const distance = offset * 1.8;
      // Tree groups are uniformly scaled; use world-sized offsets so every
      // tree follows the same sun rather than stretching with its scale.
      const treeScale = tree.scale.x;
      shadow.position.x = awayX * distance / treeScale;
      shadow.position.z = awayZ * distance / treeScale;
      shadow.rotation.z = rotation;
      // Keep the silhouette touching the trunk when the low sun moves it out.
      shadow.scale.x = Math.max(1, (distance + 0.15 * treeScale) / (0.8 * treeScale));
      if (shadow.material instanceof THREE.MeshBasicMaterial) shadow.material.opacity = 0.16 * strength;
    }
    if (chicken && chickenShadow instanceof THREE.Mesh) {
      const distance = offset * 0.9;
      chickenShadow.position.x = chicken.position.x + awayX * distance;
      chickenShadow.position.z = chicken.position.z + awayZ * distance;
      chickenShadow.rotation.z = rotation;
      chickenShadow.scale.x = Math.max(1, (distance + 0.1) / 0.43);
      if (chickenShadow.material instanceof THREE.MeshBasicMaterial) chickenShadow.material.opacity = 0.18 * strength;
    }
    for (const { spec, shadow } of buildings) {
      const distance = offset * (spec.name === 'cottage' ? 2 : 1.8);
      shadow.position.x = spec.x + awayX * distance;
      shadow.position.z = spec.z + awayZ * distance;
    }
    material.opacity = 0.12 * strength;
  }

  return { update };
}
