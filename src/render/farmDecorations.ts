import * as THREE from 'three';
import { FARM_DECORATIONS, type FarmDecorations } from '../content/farm';
import { CHICKEN_GEOMETRY as CHICKEN, DECORATION_GEOMETRY as DECORATION, NEST_GEOMETRY as NEST } from '../content/decorationGeometry';
import { ART_SLOTS } from '../content/slots';

function createChicken(flock: THREE.Group, groundHeight: number, spec: FarmDecorations['chicken']) {
  const chicken = new THREE.Group();
  chicken.name = 'farm-chicken';
  chicken.position.set(spec.x, groundHeight, spec.z);
  flock.add(chicken);

  const visual = new THREE.Group();
  chicken.add(visual);
  const feathers = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.chicken.feathers, roughness: 1 });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.chicken.wing, roughness: 1 });
  const combMaterial = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.chicken.comb, roughness: 1 });
  const beakMaterial = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.chicken.beak, roughness: 1 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.chicken.eye, roughness: 1 });

  function oval(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(...CHICKEN.oval), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    visual.add(mesh);
  }

  oval(feathers, ...CHICKEN.body);
  oval(feathers, ...CHICKEN.head);
  for (const side of [-1, 1]) {
    const [wingX, wingY, wingZ, wingScaleX, wingScaleY, wingScaleZ] = CHICKEN.wing;
    const [eyeX, eyeY, eyeZ, eyeScaleX, eyeScaleY, eyeScaleZ] = CHICKEN.eye;
    oval(wingMaterial, side * wingX, wingY, wingZ, wingScaleX, wingScaleY, wingScaleZ);
    oval(eyeMaterial, side * eyeX, eyeY, eyeZ, eyeScaleX, eyeScaleY, eyeScaleZ);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(...CHICKEN.leg), beakMaterial);
    leg.position.set(side * CHICKEN.legPosition[0], CHICKEN.legPosition[1], CHICKEN.legPosition[2]);
    visual.add(leg);
  }
  for (const z of CHICKEN.combZ) oval(combMaterial, 0, CHICKEN.combY, z, ...CHICKEN.combScale);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(...CHICKEN.beak), beakMaterial);
  beak.position.set(...CHICKEN.beakPosition);
  beak.rotation.x = Math.PI / 2;
  visual.add(beak);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(CHICKEN.shadowRadius, CHICKEN.shadowSegments),
    new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true,
      opacity: ART_SLOTS.light.contact.chickenOpacity, depthWrite: false }),
  );
  shadow.name = 'farm-chicken-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = CHICKEN.shadowScale;
  shadow.position.set(spec.x, groundHeight + CHICKEN.shadowLift, spec.z);
  flock.add(shadow);
  return chicken;
}

function createNest(flock: THREE.Group, groundHeight: number, spec: FarmDecorations['nest']) {
  const nest = new THREE.Group();
  nest.name = 'farm-nest-decoration';
  nest.position.set(spec.x, groundHeight, spec.z);
  flock.add(nest);
  const straw = new THREE.Mesh(
    new THREE.RingGeometry(...NEST.straw),
    new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.nest.straw, roughness: 1 }),
  );
  straw.rotation.x = -Math.PI / 2;
  straw.position.y = NEST.strawY;
  nest.add(straw);
  const egg = new THREE.Mesh(
    new THREE.SphereGeometry(...NEST.egg),
    new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.nest.egg, roughness: 1 }),
  );
  egg.scale.set(...NEST.eggScale);
  egg.position.y = NEST.eggY;
  nest.add(egg);
  return nest;
}

interface DecorationMaterials {
  wood: THREE.Material;
  darkWood: THREE.Material;
  lettering: THREE.Material;
}

function createBin(props: THREE.Group, groundHeight: number, spec: FarmDecorations['bin'], materials: DecorationMaterials) {
  const bin = new THREE.Group();
  bin.name = 'farm-bin';
  bin.position.set(spec.x, groundHeight, spec.z);
  props.add(bin);
  const binBody = new THREE.Mesh(new THREE.BoxGeometry(...DECORATION.binBody), materials.wood);
  binBody.position.y = DECORATION.binBodyY;
  bin.add(binBody);
  const lidHinge = new THREE.Group();
  lidHinge.position.set(...DECORATION.lidHinge);
  bin.add(lidHinge);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(...DECORATION.lid), materials.darkWood);
  lid.position.z = DECORATION.lidZ;
  lidHinge.add(lid);
  return bin;
}

function createSign(props: THREE.Group, groundHeight: number, spec: FarmDecorations['sign'], materials: DecorationMaterials) {
  const sign = new THREE.Group();
  sign.name = 'farm-sign';
  sign.position.set(spec.x, groundHeight, spec.z);
  props.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(...DECORATION.signPost), materials.darkWood);
  post.position.y = DECORATION.signPostY;
  sign.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(...DECORATION.signBoard), materials.wood);
  board.position.y = DECORATION.signBoardY;
  sign.add(board);
  for (const [y, width] of DECORATION.lettering) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(width, DECORATION.letteringHeight, DECORATION.letteringDepth), materials.lettering);
    line.position.set(0, y, DECORATION.letteringZ);
    sign.add(line);
  }
  return sign;
}

export const DECORATION_ASSETS = {
  'prop.chicken': createChicken,
  'prop.nest': createNest,
  'prop.bin': createBin,
  'prop.sign': createSign,
} as const;

/** Static scenery only; these props do not interact or block movement. */
export function createFarmDecorations(scene: THREE.Scene, groundHeight: number, content: FarmDecorations = FARM_DECORATIONS) {
  const flock = new THREE.Group();
  flock.name = 'farm-flock-decorations';
  scene.add(flock);
  const chicken = DECORATION_ASSETS[content.chicken.assetId](flock, groundHeight, content.chicken);
  const nest = DECORATION_ASSETS[content.nest.assetId](flock, groundHeight, content.nest);

  const props = new THREE.Group();
  props.name = 'farm-decorations';
  scene.add(props);
  const materials = {
    wood: new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.decoration.wood, roughness: 1 }),
    darkWood: new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.decoration.darkWood, roughness: 1 }),
    lettering: new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.decoration.lettering, roughness: 1 }),
  };
  const bin = DECORATION_ASSETS[content.bin.assetId](props, groundHeight, content.bin, materials);
  const sign = DECORATION_ASSETS[content.sign.assetId](props, groundHeight, content.sign, materials);
  // Scenery remains nonblocking for walking; placement can avoid overlapping it.
  return [chicken, nest, bin, sign];
}
