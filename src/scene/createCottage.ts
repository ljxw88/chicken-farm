import * as THREE from 'three';
import type { EmissiveAccent, WindowPane } from '../lighting/createPracticalLights';
import { GROUND_HEIGHT } from './createIsland';
import { createBuildingPane, type BuildingMaterials } from './farmBuildingMaterials';
import { type CottageSpec } from '../content/buildings';
import type { BuildingSlots } from '../content/slots';
import { buildingFootprint } from './buildingFootprint';
import { createGableRoof } from './createGableRoof';
import { COTTAGE_GEOMETRY as GEOMETRY } from '../content/buildingGeometry';

function box(parent: THREE.Group, name: string, width: number, height: number, depth: number,
  material: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

// Place a face detail within the wall footprint, with its origin on the face.
function faceDetail(parent: THREE.Group, name: string, width: number, height: number,
  material: THREE.MeshStandardMaterial, x: number, y: number, z: number, rotation = 0): WindowPane {
  const geometry = new THREE.BoxGeometry(width, height, GEOMETRY.faceDepth);
  geometry.translate(0, 0, -GEOMETRY.faceInset);
  const mesh: WindowPane = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotation;
  parent.add(mesh);
  return mesh;
}

export function createCottage(parent: THREE.Group, spec: CottageSpec, materials: BuildingMaterials, slots: BuildingSlots) {
  const { name, x, z, width, depth, height, roofRise, roofOverhang } = spec;
  const cottage = new THREE.Group();
  cottage.name = `farm-${name}`;
  cottage.position.set(x, GROUND_HEIGHT, z);
  parent.add(cottage);

  const baseHeight = GEOMETRY.baseHeight;
  box(cottage, 'cottage-stone-base', width, baseHeight, depth, materials.stone, 0, baseHeight / 2, 0);
  box(cottage, 'cottage-walls', width, height - baseHeight, depth, materials.plaster,
    0, (height + baseHeight) / 2, 0);
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    box(cottage, 'cottage-corner-post', GEOMETRY.cornerPostSize, height - baseHeight, GEOMETRY.cornerPostSize, materials.timber,
      sideX * (width / 2 - GEOMETRY.cornerInset), (height + baseHeight) / 2, sideZ * (depth / 2 - GEOMETRY.cornerInset));
  }
  for (const side of [-1, 1]) {
    box(cottage, 'cottage-eave-beam', width, GEOMETRY.eaveBeamSize, GEOMETRY.eaveBeamSize, materials.timber,
      0, height - GEOMETRY.eaveInset, side * (depth / 2 - GEOMETRY.eaveInset));
  }

  createGableRoof(cottage, {
    name, width, depth, wallTop: height, rise: roofRise, overhang: roofOverhang,
    wallMaterial: materials.plaster, roofMaterial: materials.cottageRoof, bandMaterial: materials.shingle,
  });

  const chimneyTop = GEOMETRY.chimneyTop;
  const chimneyBottom = height + roofRise - roofRise / (depth / 2) * (-GEOMETRY.chimneyZ + GEOMETRY.chimneyHalfSize) - GEOMETRY.chimneyClearance;
  box(cottage, 'cottage-chimney', GEOMETRY.chimneySize, chimneyTop - chimneyBottom, GEOMETRY.chimneySize, materials.stone,
    GEOMETRY.chimneyX, (chimneyTop + chimneyBottom) / 2, GEOMETRY.chimneyZ);
  const chimneyAnchor = new THREE.Object3D();
  chimneyAnchor.name = 'cottage-chimney-top';
  chimneyAnchor.position.set(GEOMETRY.chimneyX, chimneyTop, GEOMETRY.chimneyZ);
  cottage.add(chimneyAnchor);

  faceDetail(cottage, 'cottage-door-frame', ...GEOMETRY.doorFrame, materials.timber, 0, GEOMETRY.doorFrameY, depth / 2);
  faceDetail(cottage, 'cottage-door', ...GEOMETRY.door, materials.door, 0, GEOMETRY.doorY, depth / 2);

  const windows: WindowPane[] = [];
  for (const [index, windowX] of GEOMETRY.windowXs.entries()) {
    faceDetail(cottage, `cottage-window-frame-${index + 1}`, ...GEOMETRY.windowFrame, materials.timber, windowX, GEOMETRY.windowY, depth / 2);
    windows.push(faceDetail(cottage, `cottage-window-${index + 1}`, ...GEOMETRY.window,
      createBuildingPane(slots.cottage.glass), windowX, GEOMETRY.windowY, depth / 2));
  }
  faceDetail(cottage, 'cottage-east-window-frame', ...GEOMETRY.windowFrame, materials.timber, width / 2, GEOMETRY.windowY, 0, Math.PI / 2);
  const east = faceDetail(cottage, 'cottage-east-window', ...GEOMETRY.window,
    createBuildingPane(slots.cottage.glass), width / 2, GEOMETRY.windowY, 0, Math.PI / 2);
  const extraEmissives: EmissiveAccent[] = [{ material: east.material, strength: 1 }];

  return {
    group: cottage,
    windows, extraEmissives,
    obstacle: buildingFootprint(name, x, z, width, depth),
    splashExclusion: buildingFootprint(`${name}-roof`, x, z, width + roofOverhang * 2, depth + roofOverhang * 2),
  };
}
