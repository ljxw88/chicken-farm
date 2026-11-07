import * as THREE from 'three';
import type { FarmObstacle } from '../../character/farmCollisions';
import { createPlacementAsset } from '../../render/placementAssets';
import { fenceCollision, TILE_SIZE } from '../../placement/grid';
import { ART_SLOTS } from '../../content/slots';
import { DEFAULT_SHEEP_SEED, LEAN_TO, SHEEPFOLD, SHEEPFOLD_GEOMETRY as GEOMETRY } from '../../content/sheep';
import { SHEEPFOLD_ASSETS } from '../../render/sheepfoldAssets';
import { GROUND_HEIGHT } from '../createIsland';

// EBR-70: shift 0.5 inward from (-5.2, 4.6) so the outermost fence
// collision remains a full unit from the 16-unit island's western rim.
export { DEFAULT_SHEEP_SEED, SHEEPFOLD } from '../../content/sheep';

function randomFromSeed(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function createSheepfold(scene: THREE.Scene, seed: number = DEFAULT_SHEEP_SEED) {
  const { x, z, width, depth, shelterZ, sheepZ, sheepOffsetX, sheepRadius } = SHEEPFOLD;
  const group = new THREE.Group();
  group.name = 'farm-sheepfold';
  group.position.set(x, GROUND_HEIGHT, z);
  scene.add(group);
  const obstacles: FarmObstacle[] = [];
  const shadowGeometry = new THREE.CircleGeometry(GEOMETRY.shadowRadius, GEOMETRY.shadowSegments);
  const fenceShadowMaterial = new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true,
    opacity: ART_SLOTS.light.contact.sheepfoldFenceOpacity, depthWrite: false });
  const shelterShadowMaterial = fenceShadowMaterial.clone();
  const sheepShadowMaterial = new THREE.MeshBasicMaterial({ color: ART_SLOTS.palette.contactShadow, transparent: true,
    opacity: ART_SLOTS.light.contact.sheepfoldSheepOpacity, depthWrite: false });
  const fenceShadows: { mesh: THREE.Mesh; x: number; z: number }[] = [];
  const sheepShadows: { mesh: THREE.Mesh; x: number; z: number }[] = [];

  function shadow(name: string, sx: number, sz: number, material: THREE.MeshBasicMaterial) {
    const mesh = new THREE.Mesh(shadowGeometry, material);
    mesh.name = name;
    mesh.rotation.x = -Math.PI / 2;
    mesh.scale.set(sx, sz, 1);
    mesh.position.y = GEOMETRY.shadowLift;
    group.add(mesh);
    return mesh;
  }

  function fence(localX: number, localZ: number, rotation: number, removeCornerPost?: 0 | 1) {
    const index = fenceShadows.length + 1;
    const segment = createPlacementAsset(SHEEPFOLD.fenceAssetId);
    segment.name = `sheepfold-fence-${index}`;
    segment.position.set(localX, 0, localZ);
    segment.rotation.y = rotation * Math.PI / 2;
    // Corner posts are shared with the long side; removing only the duplicate
    // prevents coplanar overlapping meshes, while retaining the signed builder.
    if (removeCornerPost !== undefined) segment.remove(segment.children[removeCornerPost]);
    group.add(segment);
    obstacles.push(fenceCollision({ centerX: x + localX, centerZ: z + localZ }, rotation, segment.name));
    const mesh = shadow(`${segment.name}-shadow`, ...GEOMETRY.fenceShadowScale, fenceShadowMaterial);
    mesh.rotation.z = rotation % 2 ? Math.PI / 2 : 0;
    fenceShadows.push({ mesh, x: localX, z: localZ });
  }

  for (const column of GEOMETRY.backColumns) fence(column * TILE_SIZE, -depth / 2 + GEOMETRY.frontBackInset, 0);
  // The middle front segment is deliberately absent: a 1.5-unit opening.
  for (const column of GEOMETRY.frontColumns) fence(column * TILE_SIZE, depth / 2 - GEOMETRY.frontBackInset, 2);
  for (const side of GEOMETRY.sides) for (const row of GEOMETRY.rows) {
    const rotation = side === -1 ? -1 : 1;
    const cornerPost = ((side === -1) === (row === -1) ? 0 : 1) as 0 | 1;
    fence(side * (width / 2 - GEOMETRY.sideInset), row * TILE_SIZE / 2, rotation, cornerPost);
  }

  const shelter = SHEEPFOLD_ASSETS[SHEEPFOLD.shelterAssetId]();
  shelter.position.z = shelterZ - z;
  group.add(shelter);
  obstacles.push({
    kind: 'box', name: 'sheepfold-lean-to', minX: x - LEAN_TO.width / 2, maxX: x + LEAN_TO.width / 2,
    minZ: shelterZ - LEAN_TO.depth / 2, maxZ: shelterZ + LEAN_TO.depth / 2,
  });
  const shelterShadow = shadow('sheepfold-lean-to-shadow', ...GEOMETRY.shelterShadowScale, shelterShadowMaterial);

  const random = randomFromSeed(seed);
  const sheep = GEOMETRY.variants.map((variant) => {
    const animal = SHEEPFOLD_ASSETS[SHEEPFOLD.sheepAssetId](variant, random() * Math.PI * 2);
    const localX = (variant === 0 ? -1 : 1) * sheepOffsetX;
    const localZ = sheepZ - z;
    animal.group.position.set(localX, 0, localZ);
    group.add(animal.group);
    obstacles.push({ kind: 'circle', name: `sheep-${variant + 1}`, x: x + localX, z: sheepZ, radius: sheepRadius });
    const mesh = shadow(`sheep-${variant + 1}-shadow`, ...GEOMETRY.sheepShadowScale, sheepShadowMaterial);
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
      entry.mesh.position.x = entry.x + awayX * offset * GEOMETRY.fenceShadowOffset;
      entry.mesh.position.z = entry.z + awayZ * offset * GEOMETRY.fenceShadowOffset;
    }
    fenceShadowMaterial.opacity = ART_SLOTS.light.contact.sheepfoldFenceOpacity * strength;
    shelterShadow.position.x = awayX * offset * GEOMETRY.shelterShadowOffset;
    shelterShadow.position.z = shelterZ - z + awayZ * offset * GEOMETRY.shelterShadowOffset;
    shelterShadowMaterial.opacity = ART_SLOTS.light.contact.sheepfoldFenceOpacity * strength;
    for (const entry of sheepShadows) {
      const distance = offset * GEOMETRY.sheepShadowOffset;
      entry.mesh.position.x = entry.x + awayX * distance;
      entry.mesh.position.z = entry.z + awayZ * distance;
      entry.mesh.rotation.z = Math.atan2(-awayZ, awayX);
      entry.mesh.scale.x = Math.max(GEOMETRY.sheepShadowScale[0], distance + GEOMETRY.sheepShadowExtra);
    }
    sheepShadowMaterial.opacity = ART_SLOTS.light.contact.sheepfoldSheepOpacity * strength;
  }

  // Fence rails should not intercept a click intended for ground inside the
  // pen; their obstacle footprints still block the resulting walking route.
  const clickTargets = [shelter, ...sheep.map((animal) => animal.group)];
  return { group, obstacles, clickTargets, update, updateShadows };
}
