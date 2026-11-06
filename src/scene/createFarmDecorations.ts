import * as THREE from 'three';

/** Static scenery only; these props do not interact or block movement. */
export function createFarmDecorations(scene: THREE.Scene, groundHeight: number) {
  const flock = new THREE.Group();
  flock.name = 'farm-flock-decorations';
  scene.add(flock);

  const chicken = new THREE.Group();
  chicken.name = 'farm-chicken';
  chicken.position.set(1.75, groundHeight, 1.75);
  flock.add(chicken);

  const visual = new THREE.Group();
  chicken.add(visual);
  const feathers = new THREE.MeshStandardMaterial({ color: 0xfff1d7, roughness: 1 });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xe4d1ae, roughness: 1 });
  const combMaterial = new THREE.MeshStandardMaterial({ color: 0xc75b46, roughness: 1 });
  const beakMaterial = new THREE.MeshStandardMaterial({ color: 0xe9a048, roughness: 1 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x332820, roughness: 1 });

  function oval(material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    visual.add(mesh);
  }

  oval(feathers, 0, 0.44, 0, 0.4, 0.34, 0.48);
  oval(feathers, 0, 0.78, 0.27, 0.27, 0.28, 0.27);
  for (const side of [-1, 1]) {
    oval(wingMaterial, side * 0.34, 0.46, -0.05, 0.12, 0.2, 0.28);
    oval(eyeMaterial, side * 0.12, 0.83, 0.5, 0.035, 0.035, 0.035);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), beakMaterial);
    leg.position.set(side * 0.15, 0.13, 0.02);
    visual.add(leg);
  }
  for (const z of [0.16, 0.28, 0.4]) oval(combMaterial, 0, 1.05, z, 0.08, 0.105, 0.08);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.2, 4), beakMaterial);
  beak.position.set(0, 0.72, 0.57);
  beak.rotation.x = Math.PI / 2;
  visual.add(beak);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.43, 20),
    new THREE.MeshBasicMaterial({ color: 0x263b20, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.7;
  shadow.position.set(1.75, groundHeight + 0.04, 1.75);
  flock.add(shadow);

  const nest = new THREE.Group();
  nest.name = 'farm-nest-decoration';
  nest.position.set(4.3, groundHeight, 0.7);
  flock.add(nest);
  const straw = new THREE.Mesh(
    new THREE.RingGeometry(0.17, 0.29, 20),
    new THREE.MeshStandardMaterial({ color: 0xb8925b, roughness: 1 }),
  );
  straw.rotation.x = -Math.PI / 2;
  straw.position.y = 0.045;
  nest.add(straw);
  const egg = new THREE.Mesh(
    new THREE.SphereGeometry(0.17, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xfff5db, roughness: 1 }),
  );
  egg.scale.set(0.85, 1.2, 0.85);
  egg.position.y = 0.24;
  nest.add(egg);

  const props = new THREE.Group();
  props.name = 'farm-decorations';
  scene.add(props);
  const wood = new THREE.MeshStandardMaterial({ color: 0x96714a, roughness: 1 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x684a32, roughness: 1 });
  const lettering = new THREE.MeshStandardMaterial({ color: 0xf3dfb2, roughness: 1 });
  const bin = new THREE.Group();
  bin.name = 'farm-bin';
  bin.position.set(-2.8, groundHeight, -1.2);
  props.add(bin);
  const binBody = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.58, 0.6), wood);
  binBody.position.y = 0.33;
  bin.add(binBody);
  const lidHinge = new THREE.Group();
  lidHinge.position.set(0, 0.64, -0.3);
  bin.add(lidHinge);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.66), darkWood);
  lid.position.z = 0.3;
  lidHinge.add(lid);

  const sign = new THREE.Group();
  sign.name = 'farm-sign';
  sign.position.set(0.95, groundHeight, -2.35);
  props.add(sign);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 0.12), darkWood);
  post.position.y = 0.525;
  sign.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.48, 0.1), wood);
  board.position.y = 1.05;
  sign.add(board);
  for (const [y, width] of [[1.13, 0.5], [0.98, 0.32]]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.035, 0.015), lettering);
    line.position.set(0, y, 0.059);
    sign.add(line);
  }

  // Scenery remains nonblocking for walking; placement can avoid overlapping it.
  return [chicken, nest, bin, sign];
}
