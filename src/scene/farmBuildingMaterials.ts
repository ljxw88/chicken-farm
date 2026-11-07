import * as THREE from 'three';
import { ART_SLOTS, type BuildingSlots } from '../content/slots';

function material(color: number, offset = 0, roughness = 1) {
  return new THREE.MeshStandardMaterial({
    color, roughness, polygonOffset: offset !== 0, polygonOffsetFactor: offset, polygonOffsetUnits: offset,
  });
}

export function createBuildingMaterials(slots: BuildingSlots = ART_SLOTS.building) {
  // Preserve the original material creation order as well as shared defaults.
  const plaster = material(slots.cottage.plaster);
  const timber = material(slots.cottage.timber, -1);
  const door = material(slots.cottage.door, -2);
  const cottageRoof = material(slots.cottage.roof);
  const shingle = material(slots.cottage.shingle);
  const stone = material(slots.cottage.stone);
  const coopWall = material(slots.coop.wall);
  const posts = material(slots.coop.posts);
  const ramp = material(slots.coop.ramp);
  const cleats = material(slots.coop.cleats);
  const popHole = material(slots.coop.popHole, -2);
  return {
    plaster, timber, door, cottageRoof, shingle, stone, coopWall,
    coopTimber: slots.coop.timber === slots.cottage.timber ? timber : material(slots.coop.timber, -1),
    coopRoof: slots.coop.roof === slots.cottage.shingle ? shingle : material(slots.coop.roof),
    posts, ramp, cleats, popHole,
  };
}

export type BuildingMaterials = ReturnType<typeof createBuildingMaterials>;

// Each emissive pane needs its own material so lighting can ramp independently.
export function createBuildingPane(color: number) {
  return material(color, -3, 0.7);
}
