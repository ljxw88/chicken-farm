import * as THREE from 'three';
import { FLOWER_GEOMETRY as GEOMETRY, GARDEN_DRESSING } from '../../content/garden';
import { ART_SLOTS, FARM_PALETTE } from '../../content/slots';
import { GROUND_HEIGHT } from '../createIsland';

// These are deliberately scenery, not collision or placement reservations.
export const FLOWER_PATCHES = GARDEN_DRESSING.flowers.map(({ x, z, colorSlot }) => ({ x, z, color: FARM_PALETTE[colorSlot] }));

export function createFlowerPatches(parent: THREE.Object3D) {
  const group = new THREE.Group();
  group.name = 'garden-flower-patches';
  parent.add(group);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeFoliageDark, roughness: 1, flatShading: true });
  const stemGeometry = new THREE.BoxGeometry(...GEOMETRY.stem);
  const headGeometry = new THREE.CylinderGeometry(...GEOMETRY.head);
  const shadowGeometry = new THREE.CircleGeometry(...GEOMETRY.shadow);
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true,
    opacity: ART_SLOTS.light.contact.flowerOpacity, depthWrite: false });
  const shadows: THREE.Mesh[] = [];

  FLOWER_PATCHES.forEach(({ x, z, color }, index) => {
    const patch = new THREE.Group();
    patch.name = `flower-patch-${index + 1}`;
    patch.position.set(x, GROUND_HEIGHT, z);
    group.add(patch);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.name = `${patch.name}-shadow`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = GEOMETRY.shadowY;
    shadow.scale.set(...GEOMETRY.shadowScale);
    patch.add(shadow);
    shadows.push(shadow);
    const headMaterial = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
    for (const [bx, bz] of GEOMETRY.blooms[index]) {
      const stem = new THREE.Mesh(stemGeometry, stemMaterial);
      stem.name = 'flower-stem';
      stem.position.set(bx, GEOMETRY.stemY, bz);
      patch.add(stem);
      const head = new THREE.Mesh(headGeometry, headMaterial);
      head.name = 'flower-head';
      head.position.set(bx, GEOMETRY.headY, bz);
      patch.add(head);
    }
  });

  function updateShadows(awayX: number, awayZ: number, offset: number, strength: number) {
    for (const shadow of shadows) {
      shadow.position.x = awayX * offset * GEOMETRY.shadowOffset;
      shadow.position.z = awayZ * offset * GEOMETRY.shadowOffset;
    }
    shadowMaterial.opacity = ART_SLOTS.light.contact.flowerOpacity * strength;
  }
  return { group, updateShadows };
}
