import * as THREE from 'three';
import type { FarmObstacle } from '../../character/farmCollisions';
import { createPlacementAsset } from '../../render/placementAssets';
import { fenceCollision, TILE_SIZE } from '../../placement/grid';
import { ART_SLOTS } from '../../content/slots';
import { GROUND_HEIGHT } from '../createIsland';
import { createSheep } from '../sheep/createSheep';
import { createLeanTo, LEAN_TO } from './createLeanTo';

// EBR-70: shift 0.5 inward from (-5.2, 4.6) so the outermost fence
// collision remains a full unit from the 16-unit island's western rim.
export const SHEEPFOLD = {
  x: -4.7, z: 4.6, width: 3 * TILE_SIZE, depth: 2 * TILE_SIZE,
  shelterZ: 3.94, sheepZ: 4.35, sheepOffsetX: 1.4, sheepRadius: 0.4,
} as const;
export const DEFAULT_SHEEP_SEED = 0xeb700001;

function randomFromSeed(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function createSheepfold(scene: THREE.Scene, seed = DEFAULT_SHEEP_SEED) {
  const { x, z, width, depth, shelterZ, sheepZ, sheepOffsetX, sheepRadius } = SHEEPFOLD;
  const group = new THREE.Group();
  group.name = 'farm-sheepfold';
  group.position.set(x, GROUND_HEIGHT, z);
  scene.add(group);
  const obstacles: FarmObstacle[] = [];
  const shadowGeometry = new THREE.CircleGeometry(1, 20);
  const fenceShadowMaterial = new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true, opacity: 0.12, depthWrite: false });
  const shelterShadowMaterial = fenceShadowMaterial.clone();
  const sheepShadowMaterial = new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true, opacity: 0.18, depthWrite: false });
  const fenceShadows: { mesh: THREE.Mesh; x: number; z: number }[] = [];
  const sheepShadows: { mesh: THREE.Mesh; x: number; z: number }[] = [];

  function shadow(name: string, sx: number, sz: number, material: THREE.MeshBasicMaterial) {
    const mesh = new THREE.Mesh(shadowGeometry, material);
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(sx, sz, 1);
    mesh.position.y = 0.035;
    group.add(mesh);
    return mesh;
  }

  function fence(localX: number, localZ: number, rotation: number, removeCornerPost?: 0 | 1) {
    const index = fenceShadows.length + 1;
    const segment = createPlacementAsset('fence');
    segment.name = `sheepfold-fence-${index}`;
    segment.position.set(localX, 0, localZ);
    segment.rotation.y = rotation * Math.PI / 2;
    // Corner posts are shared with the long side; removing only the duplicate
    // prevents coplanar overlapping meshes, while retaining the signed builder.
    if (removeCornerPost !== undefined) segment.remove(segment.children[removeCornerPost]);
    group.add(segment);
    obstacles.push(fenceCollision({ centerX: x + localX, centerZ: z + localZ }, rotation, segment.name));
    const mesh = shadow(`${segment.name}-shadow`, 0.73, 0.18, fenceShadowMaterial);
    mesh.rotation.z = rotation % 2 ? Math.PI / 2 : 0;
    fenceShadows.push({ mesh, x: localX, z: localZ });
  }

  for (const column of [-1, 0, 1]) fence(column * TILE_SIZE, -depth / 2 + 0.1, 0);
  // The middle front segment is deliberately absent: a 1.5-unit opening.
  for (const column of [-1, 1]) fence(column * TILE_SIZE, depth / 2 - 0.1, 2);
  for (const side of [-1, 1]) for (const row of [-1, 1]) {
    const rotation = side === -1 ? -1 : 1;
    const cornerPost = ((side === -1) === (row === -1) ? 0 : 1) as 0 | 1;
    fence(side * (width / 2 - 0.08), row * TILE_SIZE / 2, rotation, cornerPost);
  }

  const shelter = createLeanTo();
  shelter.position.z = shelterZ - z;
  group.add(shelter);
  obstacles.push({
    kind: 'box', name: 'sheepfold-lean-to', minX: x - LEAN_TO.width / 2, maxX: x + LEAN_TO.width / 2,
    minZ: shelterZ - LEAN_TO.depth / 2, maxZ: shelterZ + LEAN_TO.depth / 2,
  });
  const shelterShadow = shadow('sheepfold-lean-to-shadow', 0.8, 0.7, shelterShadowMaterial);

  const random = randomFromSeed(seed);
  const sheep = ([0, 1] as const).map((variant) => {
    const animal = createSheep(variant, random() * Math.PI * 2);
    const localX = (variant === 0 ? -1 : 1) * sheepOffsetX;
    const localZ = sheepZ - z;
    animal.group.position.set(localX, 0, localZ);
    group.add(animal.group);
    obstacles.push({ kind: 'circle', name: `sheep-${variant + 1}`, x: x + localX, z: sheepZ, radius: sheepRadius });
    const mesh = shadow(`sheep-${variant + 1}-shadow`, 0.34, 0.25, sheepShadowMaterial);
    sheepShadows.push({ mesh, x: localX, z: localZ });
    return animal;
  });

  // This shared obstacle reserves the full pen for placement, not for walking.
  obstacles.push({ kind: 'box', name: 'sheepfold-placement', blocksWalking: false,
    minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });

  function update(deltaSeconds: number) {
    sheep.forEach((animal) => animal.update(deltaSeconds));
  }

  function updateShadows(awayX: number, awayZ: number, offset: number, strength: number) {
    for (const entry of fenceShadows) {
      entry.mesh.position.x = entry.x + awayX * offset * 0.35;
      entry.mesh.position.z = entry.z + awayZ * offset * 0.35;
    }
    fenceShadowMaterial.opacity = 0.12 * strength;
    shelterShadow.position.x = awayX * offset * 1.2;
    shelterShadow.position.z = shelterZ - z + awayZ * offset * 1.2;
    shelterShadowMaterial.opacity = 0.12 * strength;
    for (const entry of sheepShadows) {
      const distance = offset * 0.9;
      entry.mesh.position.x = entry.x + awayX * distance;
      entry.mesh.position.z = entry.z + awayZ * distance;
      entry.mesh.rotation.z = Math.atan2(-awayZ, awayX);
      entry.mesh.scale.x = Math.max(0.34, distance + 0.12);
    }
    sheepShadowMaterial.opacity = 0.18 * strength;
  }

  return { group, obstacles, update, updateShadows };
}
