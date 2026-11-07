import * as THREE from 'three';
import { ART_SLOTS, FARM_PALETTE } from '../content/slots';
import { PLACEMENT_GEOMETRY as GEOMETRY } from '../content/placementGeometry';
import type { PlacementKind } from '../placement/grid';
import { createGardenPlot } from '../scene/gardenDressing/createGardenPlot';

// Both the ghost and the placed object come from this same geometry and palette.
function createPlacementVisual(kind: PlacementKind) {
  if (kind === 'plot') return createGardenPlot();
  const group = new THREE.Group();
  group.name = `placement-${kind}-visual`;
  const wood = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnWood, roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnTrim, roughness: 1 });
  const postGeometry = new THREE.BoxGeometry(...GEOMETRY.fence.post);
  for (const x of GEOMETRY.fence.postXs) {
    const post = new THREE.Mesh(postGeometry, trim);
    post.position.set(x, GEOMETRY.fence.postY, 0);
    group.add(post);
  }
  const railGeometry = new THREE.BoxGeometry(...GEOMETRY.fence.rail);
  for (const y of GEOMETRY.fence.railYs) {
    const rail = new THREE.Mesh(railGeometry, wood);
    rail.position.set(0, y, GEOMETRY.fence.railZ);
    group.add(rail);
  }
  return group;
}

const PLACEMENT_ASSETS: Record<PlacementKind, () => THREE.Group> = {
  fence: () => createPlacementVisual('fence'),
  plot: () => createPlacementVisual('plot'),
};

/** Resolve the entity's plain asset ID to a render-only factory. */
export function createPlacementAsset(assetId: string) {
  if (!Object.hasOwn(PLACEMENT_ASSETS, assetId)) throw new Error(`Unknown placement asset: ${assetId}`);
  const factory = PLACEMENT_ASSETS[assetId as PlacementKind];
  return factory();
}

export function makeGhost(group: THREE.Group, opacity: number = ART_SLOTS.tint.placement.ghostOpacity) {
  const materials = new Set<THREE.MeshStandardMaterial>();
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      if (!(material instanceof THREE.MeshStandardMaterial) || materials.has(material)) continue;
      materials.add(material);
      material.transparent = true;
      material.opacity = opacity;
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
