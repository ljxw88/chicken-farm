import * as THREE from 'three';
import type { EmissiveAccent } from '../lighting/createPracticalLights';
import { GROUND_HEIGHT } from './createIsland';
import { BUILDING_PALETTE, createBuildingPane, type BuildingMaterials } from './farmBuildingMaterials';
import { buildingFootprint, type CoopSpec } from './farmBuildingSpecs';
import { createGableRoof } from './createGableRoof';

function box(parent: THREE.Group, name: string, width: number, height: number, depth: number,
  material: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

export function createRampCoop(parent: THREE.Group, spec: CoopSpec, materials: BuildingMaterials) {
  const { name, x, z, width, depth, height, floorHeight, roofRise, roofOverhang, rampWidth, rampLength } = spec;
  const coop = new THREE.Group();
  coop.name = `farm-${name}`;
  coop.position.set(x, GROUND_HEIGHT, z);
  parent.add(coop);

  // The lock's dark stub posts and lighter timber wall trim are distinct.
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    box(coop, `${name}-post`, 0.3, floorHeight, 0.3, materials.posts,
      sideX * (width / 2 - 0.15), floorHeight / 2, sideZ * (depth / 2 - 0.15));
  }
  box(coop, `${name}-body`, width, height, depth, materials.coopWall, 0, floorHeight + height / 2, 0);
  for (const side of [-1, 1]) {
    box(coop, `${name}-corner-trim`, 0.14, height, 0.1, materials.timber,
      side * (width / 2 - 0.07), floorHeight + height / 2, depth / 2 - 0.05);
    box(coop, `${name}-eave-trim`, width, 0.12, 0.1, materials.timber,
      0, floorHeight + height - 0.06, side * (depth / 2 - 0.05));
  }
  createGableRoof(coop, {
    name, width, depth, wallTop: floorHeight + height, rise: roofRise, overhang: roofOverhang,
    wallMaterial: materials.coopWall, roofMaterial: materials.shingle,
  });

  const front = depth / 2;
  box(coop, `${name}-pop-hole`, 0.4, 0.5, 0.1, materials.popHole, 0, floorHeight + 0.25, front - 0.05);
  const glowGeometry = new THREE.BoxGeometry(0.2, 0.25, 0.1);
  glowGeometry.translate(0, 0, -0.05);
  const glow = new THREE.Mesh(glowGeometry, createBuildingPane(BUILDING_PALETTE.popHole));
  glow.name = `${name}-pop-hole-glow`;
  glow.position.set(0, floorHeight + 0.25, front);
  coop.add(glow);

  // Extrude a triangular wedge so the visible ramp and its X/Z box agree.
  const rampShape = new THREE.Shape();
  rampShape.moveTo(-front, 0);
  rampShape.lineTo(-front, floorHeight);
  rampShape.lineTo(-(front + rampLength), 0);
  rampShape.closePath();
  const rampGeometry = new THREE.ExtrudeGeometry(rampShape, { depth: rampWidth, bevelEnabled: false });
  rampGeometry.rotateY(Math.PI / 2);
  const ramp = new THREE.Mesh(rampGeometry, materials.ramp);
  ramp.name = `${name}-ramp`;
  ramp.position.x = -rampWidth / 2;
  coop.add(ramp);

  const angle = Math.atan2(floorHeight, rampLength);
  for (let distance = 0.25; distance < rampLength; distance += 0.25) {
    const cleat = box(coop, `${name}-ramp-cleat`, rampWidth, 0.1, 0.1, materials.cleats,
      0, floorHeight * (1 - distance / rampLength) + Math.cos(angle) * 0.05,
      front + distance + Math.sin(angle) * 0.05);
    cleat.rotation.x = angle;
  }
  const extraEmissives: EmissiveAccent[] = [{ material: glow.material, strength: 0.7 }];

  return {
    extraEmissives,
    obstacles: [
      buildingFootprint(`${name}-body`, x, z, width, depth),
      buildingFootprint(`${name}-ramp`, x, z + front + rampLength / 2, rampWidth, rampLength),
    ],
    splashExclusion: buildingFootprint(`${name}-roof`, x, z, width + roofOverhang * 2, depth + roofOverhang * 2),
  };
}
