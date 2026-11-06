import * as THREE from 'three';
import { FARM_PALETTE } from './farmPalette';

// Building-only colors; the old barn colors still supply fences and stairs.
export const BUILDING_PALETTE = {
  plaster: 0xefe3c8,
  timber: 0x8b5e3c,
  door: FARM_PALETTE.barnDoor,
  cottageRoof: FARM_PALETTE.barnRoof,
  shingle: 0xa94a30,
  stone: 0x9a8a78,
  glass: FARM_PALETTE.barnWindow,
  coopWall: 0xc8956c,
  posts: FARM_PALETTE.barnDoor,
  ramp: FARM_PALETTE.dirt,
  cleats: FARM_PALETTE.dirtEdge,
  popHole: 0x3e2a1a,
} as const;

function material(color: number, offset = 0, roughness = 1) {
  return new THREE.MeshStandardMaterial({
    color, roughness, polygonOffset: offset !== 0, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
}

export function createBuildingMaterials() {
  return {
    plaster: material(BUILDING_PALETTE.plaster),
    timber: material(BUILDING_PALETTE.timber, -1),
    door: material(BUILDING_PALETTE.door, -2),
    cottageRoof: material(BUILDING_PALETTE.cottageRoof),
    shingle: material(BUILDING_PALETTE.shingle),
    stone: material(BUILDING_PALETTE.stone),
    coopWall: material(BUILDING_PALETTE.coopWall),
    posts: material(BUILDING_PALETTE.posts),
    ramp: material(BUILDING_PALETTE.ramp),
    cleats: material(BUILDING_PALETTE.cleats),
    popHole: material(BUILDING_PALETTE.popHole, -2),
  };
}

export type BuildingMaterials = ReturnType<typeof createBuildingMaterials>;

// Each emissive pane needs its own material so lighting can ramp independently.
export function createBuildingPane(color: number) {
  return material(color, -3, 0.7);
}
