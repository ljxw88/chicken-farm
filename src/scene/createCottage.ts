import * as THREE from 'three';
import type { EmissiveAccent, WindowPane } from '../lighting/createPracticalLights';
import { GROUND_HEIGHT } from './createIsland';
import { BUILDING_PALETTE, createBuildingPane, type BuildingMaterials } from './farmBuildingMaterials';
import { buildingFootprint, type CottageSpec } from './farmBuildingSpecs';
import { createGableRoof } from './createGableRoof';

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
  const geometry = new THREE.BoxGeometry(width, height, 0.1);
  geometry.translate(0, 0, -0.05);
  const mesh: WindowPane = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotation;
  parent.add(mesh);
  return mesh;
}

export function createCottage(parent: THREE.Group, spec: CottageSpec, materials: BuildingMaterials) {
  const { name, x, z, width, depth, height, roofRise, roofOverhang } = spec;
  const cottage = new THREE.Group();
  cottage.name = `farm-${name}`;
  cottage.position.set(x, GROUND_HEIGHT, z);
  parent.add(cottage);

  const baseHeight = 0.25;
  box(cottage, 'cottage-stone-base', width, baseHeight, depth, materials.stone, 0, baseHeight / 2, 0);
  box(cottage, 'cottage-walls', width, height - baseHeight, depth, materials.plaster,
    0, (height + baseHeight) / 2, 0);
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    box(cottage, 'cottage-corner-post', 0.16, height - baseHeight, 0.16, materials.timber,
      sideX * (width / 2 - 0.08), (height + baseHeight) / 2, sideZ * (depth / 2 - 0.08));
  }
  for (const side of [-1, 1]) {
    box(cottage, 'cottage-eave-beam', width, 0.12, 0.12, materials.timber,
      0, height - 0.06, side * (depth / 2 - 0.06));
  }

  createGableRoof(cottage, {
    name, width, depth, wallTop: height, rise: roofRise, overhang: roofOverhang,
    wallMaterial: materials.plaster, roofMaterial: materials.cottageRoof, bandMaterial: materials.shingle,
  });

  const chimneyTop = 3.6;
  const chimneyBottom = height + roofRise - roofRise / (depth / 2) * (0.7 + 0.225) - 0.1;
  box(cottage, 'cottage-chimney', 0.45, chimneyTop - chimneyBottom, 0.45, materials.stone,
    1.5, (chimneyTop + chimneyBottom) / 2, -0.7);
  const chimneyAnchor = new THREE.Object3D();
  chimneyAnchor.name = 'cottage-chimney-top';
  chimneyAnchor.position.set(1.5, chimneyTop, -0.7);
  cottage.add(chimneyAnchor);

  faceDetail(cottage, 'cottage-door-frame', 1.34, 1.72, materials.timber, 0, 0.86, depth / 2);
  faceDetail(cottage, 'cottage-door', 1.1, 1.6, materials.door, 0, 0.8, depth / 2);

  const windows: WindowPane[] = [];
  for (const [index, windowX] of [-1.2, 1.2].entries()) {
    faceDetail(cottage, `cottage-window-frame-${index + 1}`, 1.04, 1.04, materials.timber, windowX, 1.2, depth / 2);
    windows.push(faceDetail(cottage, `cottage-window-${index + 1}`, 0.8, 0.8,
      createBuildingPane(BUILDING_PALETTE.glass), windowX, 1.2, depth / 2));
  }
  faceDetail(cottage, 'cottage-east-window-frame', 1.04, 1.04, materials.timber, width / 2, 1.2, 0, Math.PI / 2);
  const east = faceDetail(cottage, 'cottage-east-window', 0.8, 0.8,
    createBuildingPane(BUILDING_PALETTE.glass), width / 2, 1.2, 0, Math.PI / 2);
  const extraEmissives: EmissiveAccent[] = [{ material: east.material, strength: 1 }];

  return {
    group: cottage,
    windows, extraEmissives,
    obstacle: buildingFootprint(name, x, z, width, depth),
    splashExclusion: buildingFootprint(`${name}-roof`, x, z, width + roofOverhang * 2, depth + roofOverhang * 2),
  };
}
