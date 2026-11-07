import * as THREE from 'three';
import { FARM_PALETTE } from '../scene/farmPalette';
import { createGardenPlot } from '../scene/gardenDressing/createGardenPlot';
import type { PlacementKind } from './grid';

// Both the ghost and the placed object come from this same geometry and palette.
export function createPlacementVisual(kind: PlacementKind) {
  if (kind === 'plot') return createGardenPlot();
  const group = new THREE.Group();
  group.name = `placement-${kind}-visual`;

  const wood = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnWood, roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnTrim, roughness: 1 });
  const postGeometry = new THREE.BoxGeometry(0.17, 0.95, 0.17);
  for (const x of [-0.65, 0.65]) {
    const post = new THREE.Mesh(postGeometry, trim);
    post.position.set(x, 0.475, 0);
    group.add(post);
  }
  const railGeometry = new THREE.BoxGeometry(1.4, 0.13, 0.1);
  for (const y of [0.32, 0.67]) {
    const rail = new THREE.Mesh(railGeometry, wood);
    rail.position.set(0, y, 0.08);
    group.add(rail);
  }
  return group;
}

export function makeGhost(group: THREE.Group) {
  const materials = new Set<THREE.MeshStandardMaterial>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || materials.has(material)) continue;
      materials.add(material);
      material.transparent = true;
      material.opacity = 0.5;
      material.depthWrite = false;
    }
    object.renderOrder = 2;
  });
}

export function disposePlacementVisual(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  group.removeFromParent();
}
