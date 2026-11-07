import * as THREE from 'three';
import { CONTACT_SHADOW_COLOR } from '../contactShadowStyle';
import { GROUND_HEIGHT } from '../createIsland';
import { FARM_PALETTE } from '../farmPalette';

// These are deliberately scenery, not collision or placement reservations.
export const FLOWER_PATCHES = [
  { x: -1.2, z: 4.1, color: FARM_PALETTE.flowerRed },
  { x: 1.4, z: 4.6, color: FARM_PALETTE.flowerYellow },
  { x: -7, z: 0.9, color: FARM_PALETTE.flowerBlue },
  { x: 6, z: 4.5, color: FARM_PALETTE.flowerOrange },
] as const;

// Each colourway has its own hand-arranged silhouette, not a recoloured copy.
const BLOOMS = [
  [[-0.26, -0.22], [-0.04, -0.28], [0.22, -0.23], [-0.25, 0.09], [0.02, 0.04], [0.26, 0.13], [-0.08, 0.27]],
  [[-0.25, -0.24], [0.03, -0.28], [0.27, -0.1], [-0.2, 0.09], [0.07, 0.05], [0.18, 0.27]],
  [[-0.27, -0.18], [-0.02, -0.27], [0.22, -0.25], [-0.22, 0.02], [0.05, -0.02], [0.27, 0.09], [-0.17, 0.24], [0.1, 0.26]],
  [[-0.28, -0.1], [-0.12, -0.25], [0.15, -0.24], [0.28, -0.03], [-0.23, 0.17], [0.04, 0.04], [0.19, 0.24]],
] as const;

export function createFlowerPatches(parent: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = 'garden-flower-patches';
  parent.add(group);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeFoliageDark, roughness: 1, flatShading: true });
  const stemGeometry = new THREE.BoxGeometry(0.11, 0.2, 0.11);
  const headGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.14, 6);
  const shadowGeometry = new THREE.CircleGeometry(1, 16);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: CONTACT_SHADOW_COLOR, transparent: true, opacity: 0.07, depthWrite: false });
  const shadows: THREE.Mesh[] = [];

  FLOWER_PATCHES.forEach(({ x, z, color }, index) => {
    const patch = new THREE.Group();
    patch.name = `flower-patch-${index + 1}`;
    patch.position.set(x, GROUND_HEIGHT, z);
    group.add(patch);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.name = `${patch.name}-shadow`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    shadow.scale.set(0.38, 0.3, 1);
    patch.add(shadow);
    shadows.push(shadow);
    const headMaterial = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    for (const [bx, bz] of BLOOMS[index]) {
      const stem = new THREE.Mesh(stemGeometry, stemMaterial);
      stem.name = 'flower-stem';
      stem.position.set(bx, 0.1, bz);
      patch.add(stem);
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.name = 'flower-head';
      head.position.set(bx, 0.25, bz);
      patch.add(head);
    }
  });

  function updateShadows(awayX: number, awayZ: number, offset: number, strength: number) {
    for (const shadow of shadows) {
      shadow.position.x = awayX * offset * 0.2;
      shadow.position.z = awayZ * offset * 0.2;
    }
    shadowMaterial.opacity = 0.07 * strength;
  }
  return { group, updateShadows };
}
