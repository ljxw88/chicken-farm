import * as THREE from 'three';
import type { EmissiveAccent } from '../lighting/createPracticalLights';
import { GROUND_HEIGHT } from './createIsland';
import { createBuildingPane, type BuildingMaterials } from './farmBuildingMaterials';
import type { CoopSpec } from '../content/buildings';
import type { BuildingSlots } from '../content/slots';
import { buildingFootprint } from './buildingFootprint';
import { createGableRoof } from './createGableRoof';
import { COOP_GEOMETRY as GEOMETRY } from '../content/buildingGeometry';

function box(parent: THREE.Group, name: string, width: number, height: number, depth: number,
  material: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

export function createRampCoop(parent: THREE.Group, spec: CoopSpec, materials: BuildingMaterials, slots: BuildingSlots) {
  const { name, x, z, width, depth, height, floorHeight, roofRise, roofOverhang, rampWidth, rampLength } = spec;
  const coop = new THREE.Group();
  coop.name = `farm-${name}`;
  coop.position.set(x, GROUND_HEIGHT, z);
  parent.add(coop);

  // The lock's dark stub posts and lighter timber wall trim are distinct.
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    box(coop, `${name}-post`, GEOMETRY.postSize, floorHeight, GEOMETRY.postSize, materials.posts,
      sideX * (width / 2 - GEOMETRY.postInset), floorHeight / 2, sideZ * (depth / 2 - GEOMETRY.postInset));
  }
  box(coop, `${name}-body`, width, height, depth, materials.coopWall, 0, floorHeight + height / 2, 0);
  for (const side of [-1, 1]) {
    box(coop, `${name}-corner-trim`, GEOMETRY.trimWidth, height, GEOMETRY.trimDepth, materials.coopTimber,
      side * (width / 2 - GEOMETRY.trimXInset), floorHeight + height / 2, depth / 2 - GEOMETRY.trimZInset);
    box(coop, `${name}-eave-trim`, width, GEOMETRY.eaveHeight, GEOMETRY.trimDepth, materials.coopTimber,
      0, floorHeight + height - GEOMETRY.eaveYInset, side * (depth / 2 - GEOMETRY.trimZInset));
  }
  createGableRoof(coop, {
    name, width, depth, wallTop: floorHeight + height, rise: roofRise, overhang: roofOverhang,
    wallMaterial: materials.coopWall, roofMaterial: materials.coopRoof,
  });

  const front = depth / 2;
  box(coop, `${name}-pop-hole`, ...GEOMETRY.popHole, materials.popHole, 0, floorHeight + GEOMETRY.popHoleY, front - GEOMETRY.popHoleInset);
  const glowGeometry = new THREE.BoxGeometry(...GEOMETRY.glow);
  glowGeometry.translate(0, 0, -GEOMETRY.glowInset);
  const glow = new THREE.Mesh(glowGeometry, createBuildingPane(slots.coop.popHole));
  glow.name = `${name}-pop-hole-glow`;
  glow.position.set(0, floorHeight + GEOMETRY.popHoleY, front);
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
  for (let distance = GEOMETRY.cleatSpacing; distance < rampLength; distance += GEOMETRY.cleatSpacing) {
    const cleat = box(coop, `${name}-ramp-cleat`, rampWidth, GEOMETRY.cleatHeight, GEOMETRY.cleatDepth, materials.cleats,
      0, floorHeight * (1 - distance / rampLength) + Math.cos(angle) * GEOMETRY.cleatOffset,
      front + distance + Math.sin(angle) * GEOMETRY.cleatOffset);
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
