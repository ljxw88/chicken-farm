import * as THREE from 'three';
import type { FarmBounds } from './farmCollisions';

// The path meets the +X rim at z ~= 0.75. These dimensions describe both the
// visible blocks and the small extension of the island's walkable surface.
const STAIR_CENTER_Z = 0.75;
const STAIR_WIDTH = 1.2;
const TREAD_DEPTH = 0.9;
const TREAD_COUNT = 5;

export interface StoneStairs {
  treads: THREE.Mesh[];
  bounds: FarmBounds;
  supports(x: number, z: number, radius: number): boolean;
  floorHeight(x: number): number;
  characterHeight(x: number, radius: number): number;
  target(x: number, z: number, radius: number): { x: number; z: number };
}

export function createStoneStairs(island: THREE.Group, size: number, top: number, bottom: number): StoneStairs {
  const edge = size / 2;
  const end = edge + TREAD_COUNT * TREAD_DEPTH;
  const minZ = STAIR_CENTER_Z - STAIR_WIDTH / 2;
  const maxZ = STAIR_CENTER_Z + STAIR_WIDTH / 2;
  const rise = (top - bottom) / TREAD_COUNT;
  const stairs = new THREE.Group();
  stairs.name = 'island-stone-stairs';
  island.add(stairs);

  // A restrained warm stone, separate from the locked farm palette. The
  // horizontal faces stay lighter than the risers through the pixel pass.
  const stone = new THREE.MeshStandardMaterial({ color: 0x9f8e78, roughness: 1 });
  const tread = new THREE.MeshStandardMaterial({ color: 0xc3b49b, roughness: 1 });
  const materials = [stone, stone, tread, stone, stone, stone];
  const treads = Array.from({ length: TREAD_COUNT }, (_, index) => {
    const height = top - index * rise - bottom;
    const block = new THREE.Mesh(new THREE.BoxGeometry(TREAD_DEPTH, height, STAIR_WIDTH), materials);
    block.name = `stone-step-${index + 1}`;
    block.position.set(edge + (index + 0.5) * TREAD_DEPTH, bottom + height / 2, STAIR_CENTER_Z);
    stairs.add(block);
    return block;
  });

  const bounds = { minX: -edge, maxX: end, minZ: -edge, maxZ: edge };

  function supports(x: number, z: number, radius: number) {
    if (x < -edge + radius || x > end - radius || z < -edge + radius || z > edge - radius) return false;
    if (x <= edge - radius) return true;
    if (x >= edge) return z >= minZ + radius && z <= maxZ - radius;

    // At the two inside corners, the circular footprint can straddle the
    // island and stair tops as long as it does not overlap the void.
    const cornerInset = Math.sqrt(Math.max(0, radius * radius - (edge - x) ** 2));
    return z >= minZ + cornerInset && z <= maxZ - cornerInset;
  }

  function treadIndex(x: number) {
    return Math.min(TREAD_COUNT - 1, Math.max(0, Math.floor((x - edge) / TREAD_DEPTH)));
  }

  function floorHeight(x: number) {
    return x <= edge ? top : top - treadIndex(x) * rise;
  }

  function characterHeight(x: number, radius: number) {
    const index = x <= edge ? 0 : treadIndex(x);
    const floor = top - index * rise;
    if (index === 0 || radius <= 0) return floor;

    const distance = x - (edge + index * TREAD_DEPTH);
    const higher = floor + rise;
    if (distance < radius) {
      // The character's lower capsule touches the upper tread's edge before
      // its center reaches it, rather than clipping through the riser.
      return Math.max(floor, higher - radius + Math.sqrt(Math.max(0, radius * radius - distance * distance)));
    }

    // A rise slightly taller than the capsule radius needs a brief settling
    // interval after it clears the edge. It is still above the visible stone.
    const settleDistance = Math.min(0.08, Math.max(0, TREAD_DEPTH - radius * 2));
    if (rise > radius && settleDistance > 0 && distance < radius + settleDistance) {
      return floor + (rise - radius) * (1 - (distance - radius) / settleDistance);
    }
    return floor;
  }

  function target(x: number, z: number, radius: number) {
    return {
      x: THREE.MathUtils.clamp(x, edge, end - radius),
      z: THREE.MathUtils.clamp(z, minZ + radius, maxZ - radius),
    };
  }

  return { treads, bounds, supports, floorHeight, characterHeight, target };
}
