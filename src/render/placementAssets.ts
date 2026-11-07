import * as THREE from 'three';
import { ART_SLOTS, FARM_PALETTE } from '../content/slots';
import { TILE_SIZE, type PlacementKind } from '../placement/grid';
import { GRID } from '../content/world';
import { PLACEMENT_GEOMETRY as GEOMETRY } from '../content/placementGeometry';

// Both the ghost and the placed object come from this same geometry and palette.
function createPlacementVisual(kind: PlacementKind) {
  const group = new THREE.Group();
  group.name = `placement-${kind}-visual`;

  if (kind === 'fence') {
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
  } else {
    const edge = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirtEdge, roughness: 1 });
    const dirt = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirt, roughness: 1 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * GRID.footprints.plot.columns - GEOMETRY.plot.baseInset,
      GEOMETRY.plot.baseHeight, TILE_SIZE - GEOMETRY.plot.baseInset), edge);
    base.position.y = GEOMETRY.plot.baseY;
    group.add(base);
    const surface = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE * GRID.footprints.plot.columns - GEOMETRY.plot.surfaceInset,
      GEOMETRY.plot.surfaceHeight, TILE_SIZE - GEOMETRY.plot.surfaceInset), dirt);
    surface.position.y = GEOMETRY.plot.surfaceY;
    group.add(surface);
    const furrowGeometry = new THREE.BoxGeometry(TILE_SIZE * GRID.footprints.plot.columns - GEOMETRY.plot.furrowInset,
      GEOMETRY.plot.furrowHeight, GEOMETRY.plot.furrowDepth);
    for (const z of GEOMETRY.plot.furrowZs) {
      const furrow = new THREE.Mesh(furrowGeometry, edge);
      furrow.position.set(0, GEOMETRY.plot.furrowY, z);
      group.add(furrow);
    }
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
