import * as THREE from 'three';

export const CHARACTER_RADIUS = 0.4;
const BODY_LENGTH = 0.6;

export function createCharacter() {
  // The group's origin is at the character's feet on the ground plane.
  const character = new THREE.Group();
  character.name = 'character';

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(CHARACTER_RADIUS, BODY_LENGTH, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xffd477, roughness: 0.9 }),
  );
  body.position.y = CHARACTER_RADIUS + BODY_LENGTH / 2;
  character.add(body);

  // A little face makes the direction of travel visible.
  const eyeGeometry = new THREE.SphereGeometry(0.045, 10, 8);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x302820 });
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(x, 1.04, 0.38);
    character.add(eye);
  }

  const beak = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xe99049, roughness: 0.9 }),
  );
  beak.scale.set(0.13, 0.09, 0.13);
  beak.position.set(0, 0.85, 0.4);
  character.add(beak);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(CHARACTER_RADIUS, 24),
    new THREE.MeshBasicMaterial({ color: 0x263b20, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.7;
  shadow.position.y = 0.012;
  character.add(shadow);

  return character;
}
