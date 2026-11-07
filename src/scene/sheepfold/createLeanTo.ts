import * as THREE from 'three';
import { ART_SLOTS, type SheepfoldSlots } from '../../content/slots';
import { LEAN_TO, LEAN_TO_GEOMETRY as GEOMETRY } from '../../content/sheep';

export { LEAN_TO } from '../../content/sheep';

// Shape X becomes world -Z, extrusion becomes world +X (as in createGableRoof).
function prism(shape: THREE.Shape, width: number, material: THREE.Material, name: string) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

export function createLeanTo(slots: SheepfoldSlots = ART_SLOTS.building.sheepfold) {
  const group = new THREE.Group();
  group.name = 'sheepfold-lean-to';
  const wall = new THREE.MeshStandardMaterial({ color: slots.wall, roughness: 1 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: slots.roof, roughness: 1 });
  const postMaterial = new THREE.MeshStandardMaterial({ color: slots.posts, roughness: 1 });
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
  box('sheepfold-back-wall', width - GEOMETRY.backWidthInset, GEOMETRY.backHeight, GEOMETRY.backDepth,
    wall, 0, GEOMETRY.backY, -depth / 2 + GEOMETRY.backZInset);
  const sideShape = new THREE.Shape();
  const back = -depth / 2 + GEOMETRY.sideInset;
  const front = depth / 2 - GEOMETRY.sideInset;
  sideShape.moveTo(-back, 0);
  sideShape.lineTo(-front, 0);
  sideShape.lineTo(-front, roofTop(front) - GEOMETRY.sideTopInset);
  sideShape.lineTo(-back, roofTop(back) - GEOMETRY.sideTopInset);
  sideShape.closePath();
  for (const side of [-1, 1]) {
    const sideWall = prism(sideShape, GEOMETRY.sideThickness, wall, 'sheepfold-side-wall');
    sideWall.position.x = side * (width / 2 - GEOMETRY.sideXInset) - GEOMETRY.sideXInset;
    group.add(sideWall);
    for (const z of [-depth / 2 + GEOMETRY.postZInset, depth / 2 - GEOMETRY.postZInset]) {
      const postHeight = roofTop(z) - GEOMETRY.postTopInset;
      box('sheepfold-post', GEOMETRY.postSize, postHeight, GEOMETRY.postSize, postMaterial,
        side * (width / 2 - GEOMETRY.postXInset), postHeight / 2, z);
    }
  }
  const roofShape = new THREE.Shape();
  const rear = -depth / 2 - overhang;
  const edge = depth / 2 + overhang;
  roofShape.moveTo(-rear, roofTop(rear));
  roofShape.lineTo(-edge, roofTop(edge));
  roofShape.lineTo(-edge, roofTop(edge) - GEOMETRY.roofThickness);
  roofShape.lineTo(-rear, roofTop(rear) - GEOMETRY.roofThickness);
  roofShape.closePath();
  const roof = prism(roofShape, width + overhang * 2, roofMaterial, 'sheepfold-roof');
  roof.position.x = -(width + overhang * 2) / 2;
  group.add(roof);
  return group;
}
