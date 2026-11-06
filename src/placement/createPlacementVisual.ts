import * as THREE from 'three';
import { FARM_PALETTE } from '../scene/farmPalette';
import { TILE_SIZE, type PlacementKind } from './grid';

// Both the ghost and the placed object come from this same geometry and palette.
export function createPlacementVisual(kind: PlacementKind) {
  const group = new THREE.Group();
  group.name = `placement-${kind}-visual`;

  if (kind === 'fence') {
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
  } else {
    const edge = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirtEdge, roughness: 1 });
    const dirt = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirt, roughness: 1 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 2 - 0.06, 0.1, TILE_SIZE - 0.06), edge);
    base.position.y = 0.05;
    group.add(base);
    const surface = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * 2 - 0.2, 0.04, TILE_SIZE - 0.2), dirt);
    surface.position.y = 0.11;
    group.add(surface);
    const furrowGeometry = new THREE.BoxGeometry(TILE_SIZE * 2 - 0.32, 0.025, 0.13);
    for (const z of [-0.4, 0, 0.4]) {
      const furrow = new THREE.Mesh(furrowGeometry, edge);
      furrow.position.set(0, 0.142, z);
      group.add(furrow);
    }
  }
  return group;
}

export function makeGhost(group: THREE.Group) {
  const colors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || colors.has(material)) continue;
      colors.set(material, material.color.clone());
      material.transparent = true;
      material.opacity = 0.5;
      material.depthWrite = false;
    }
    object.renderOrder = 2;
  });
  return (wash: THREE.Color) => {
    for (const [material, color] of colors) material.color.copy(color).lerp(wash, 0.5);
  };
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
