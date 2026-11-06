import * as THREE from 'three';
import { BUILDING_PALETTE } from '../farmBuildingMaterials';

export const LEAN_TO = { width: 1.4, depth: 1.2, height: 1.1, rise: 0.3, overhang: 0.12 } as const;

// Shape X becomes world -Z, extrusion becomes world +X (as in createGableRoof).
function prism(shape: THREE.Shape, width: number, material: THREE.Material, name: string) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

export function createLeanTo() {
  const group = new THREE.Group();
  group.name = 'sheepfold-lean-to';
  const wall = new THREE.MeshStandardMaterial({ color: BUILDING_PALETTE.coopWall, roughness: 1 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: BUILDING_PALETTE.shingle, roughness: 1 });
  const postMaterial = new THREE.MeshStandardMaterial({ color: BUILDING_PALETTE.posts, roughness: 1 });
  const { width, depth, height, rise, overhang } = LEAN_TO;

  function box(name: string, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  // The roof is highest at the back and open at the +Z front. The 1.1-unit
  // height includes the rear overhang; its vertical thickness is 0.1.
  const roofTop = (z: number) => height - (z + depth / 2 + overhang) * rise / depth;
  box('sheepfold-back-wall', width - 0.24, 0.95, 0.1, wall, 0, 0.475, -depth / 2 + 0.05);
  const sideShape = new THREE.Shape();
  const back = -depth / 2 + 0.12;
  const front = depth / 2 - 0.12;
  sideShape.moveTo(-back, 0);
  sideShape.lineTo(-front, 0);
  sideShape.lineTo(-front, roofTop(front) - 0.11);
  sideShape.lineTo(-back, roofTop(back) - 0.11);
  sideShape.closePath();
  for (const side of [-1, 1]) {
    const sideWall = prism(sideShape, 0.1, wall, 'sheepfold-side-wall');
    sideWall.position.x = side * (width / 2 - 0.05) - 0.05;
    group.add(sideWall);
    for (const z of [-depth / 2 + 0.06, depth / 2 - 0.06]) {
      const postHeight = roofTop(z) - 0.1;
      box('sheepfold-post', 0.12, postHeight, 0.12, postMaterial,
        side * (width / 2 - 0.06), postHeight / 2, z);
    }
  }
  const roofShape = new THREE.Shape();
  const rear = -depth / 2 - overhang;
  const edge = depth / 2 + overhang;
  roofShape.moveTo(-rear, roofTop(rear));
  roofShape.lineTo(-edge, roofTop(edge));
  roofShape.lineTo(-edge, roofTop(edge) - 0.1);
  roofShape.lineTo(-rear, roofTop(rear) - 0.1);
  roofShape.closePath();
  const roof = prism(roofShape, width + overhang * 2, roofMaterial, 'sheepfold-roof');
  roof.position.x = -(width + overhang * 2) / 2;
  group.add(roof);
  return group;
}
