import * as THREE from 'three';
import { FARM_PALETTE } from '../scene/farmPalette';

/** Small, non-emissive details sit partly inside the existing capsule. */
export function createCharacterDetails(body: THREE.Mesh) {
  const oval = new THREE.SphereGeometry(1, 12, 8);
  const combMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.flowerRed, roughness: 0.9 });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.characterWingGold, roughness: 0.9 });

  const comb = new THREE.Group();
  comb.name = 'character-comb';
  for (const [index, x] of [-0.1, 0, 0.1].entries()) {
    const bump = new THREE.Mesh(oval, combMaterial);
    bump.name = `character-comb-bump-${index + 1}`;
    bump.position.set(x, 0.62, 0.17);
    bump.scale.set(0.07, 0.06, 0.07);
    comb.add(bump);
  }
  body.add(comb);

  for (const [side, name] of [[-1, 'left'], [1, 'right']] as const) {
    const wing = new THREE.Mesh(oval, wingMaterial);
    wing.name = `character-wing-${name}`;
    wing.position.set(side * 0.36, 0.1, 0);
    wing.scale.set(0.05, 0.15, 0.11);
    body.add(wing);
  }
}
