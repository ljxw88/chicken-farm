import * as THREE from 'three';
import { PLAYER_GEOMETRY } from '../content/playerGeometry';
import { ART_SLOTS } from '../content/slots';

/** Small, non-emissive details sit partly inside the existing capsule. */
export function createCharacterDetails(body: THREE.Mesh) {
  const { details } = PLAYER_GEOMETRY;
  const oval = new THREE.SphereGeometry(...details.oval);
  const combMaterial = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.character.comb,
    roughness: ART_SLOTS.prop.character.detailRoughness });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: ART_SLOTS.palette.character.wing,
    roughness: ART_SLOTS.prop.character.detailRoughness });

  const comb = new THREE.Group();
  comb.name = 'character-comb';
  for (const [index, x] of details.combXs.entries()) {
    const bump = new THREE.Mesh(oval, combMaterial);
    bump.name = `character-comb-bump-${index + 1}`;
    bump.position.set(x, details.combY, details.combZ);
    bump.scale.set(...details.combScale);
    comb.add(bump);
  }
  body.add(comb);

  for (const [index, position] of details.wingPositions.entries()) {
    const wing = new THREE.Mesh(oval, wingMaterial);
    wing.name = `character-wing-${index === 0 ? 'left' : 'right'}`;
    wing.position.set(position[0], position[1], position[2]);
    wing.scale.set(...details.wingScale);
    body.add(wing);
  }
}
