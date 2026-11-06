import * as THREE from 'three';
import type { FarmBounds } from './farmCollisions';
import { FARM_PALETTE } from './farmPalette';

// The path meets the +X rim at z ~= 0.75. These dimensions describe both the
// visible blocks and the small extension of the island's walkable surface.
const STAIR_CENTER_Z = 0.75;
const STAIR_WIDTH = 1.2;
const TREAD_DEPTH = 0.9;
const TREAD_COUNT = 5;
const PAD_LENGTH = 1.5;
const PAD_WIDTH = 1.6;
const PAD_HEIGHT = 0.16;
const PAD_OVERLAP = 0.45;
const EDGE_DEPTH = 0.18;
const TREAD_MIXES = [0.76, 0.82, 0.78, 0.84, 0.8];

export interface StoneStairs {
  treads: THREE.Mesh[];
  footPad: THREE.Mesh;
  bounds: FarmBounds;
  supports(x: number, z: number, radius: number): boolean;
  floorHeight(x: number): number;
  characterHeight(x: number, radius: number): number;
  target(x: number, z: number, radius: number): { x: number; z: number };
}

export function createStoneStairs(island: THREE.Group, size: number, top: number, bottom: number): StoneStairs {
  const edge = size / 2;
  const stairEnd = edge + TREAD_COUNT * TREAD_DEPTH;
  const padStart = stairEnd - PAD_OVERLAP;
  const padEnd = padStart + PAD_LENGTH;
  const minZ = STAIR_CENTER_Z - STAIR_WIDTH / 2;
  const maxZ = STAIR_CENTER_Z + STAIR_WIDTH / 2;
  const padMinZ = STAIR_CENTER_Z - PAD_WIDTH / 2;
  const padMaxZ = STAIR_CENTER_Z + PAD_WIDTH / 2;
  const rise = (top - bottom) / TREAD_COUNT;
  const stairs = new THREE.Group();
  stairs.name = 'island-stone-stairs';
  island.add(stairs);

  // Derive the stone from the existing barn wall and dirt path, not a new
  // palette. Subtle top variations and a wider-than-one-pixel edge survive the
  // pixel pass without emissive light or a change to the locked lighting.
  const barn = new THREE.Color(FARM_PALETTE.barnWood);
  const dirt = new THREE.Color(FARM_PALETTE.dirt);
  const stone = new THREE.MeshStandardMaterial({ color: dirt.clone().lerp(barn, 0.18), roughness: 1 });

  function block(length: number, height: number, width: number, mix: number) {
    const color = dirt.clone().lerp(barn, mix);
    const tread = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    const tint = new THREE.MeshStandardMaterial({ color: color.clone().lerp(barn, 0.5).multiplyScalar(1.1), roughness: 1 });
    const geometry = new THREE.BoxGeometry(length, height, width, Math.round(length / EDGE_DEPTH), 1, 1);
    const groups = geometry.groups.slice();
    geometry.clearGroups();
    for (const group of groups) {
      if (group.materialIndex === 2) {
        // The last top-face segment is the camera-facing +X tread edge.
        geometry.addGroup(group.start, group.count - 6, 2);
        geometry.addGroup(group.start + group.count - 6, 6, 6);
      } else {
        geometry.addGroup(group.start, group.count, group.materialIndex);
      }
    }
    return new THREE.Mesh(geometry, [stone, stone, tread, stone, stone, stone, tint]);
  }

  const treads = Array.from({ length: TREAD_COUNT }, (_, index) => {
    const height = top - index * rise - bottom;
    const step = block(TREAD_DEPTH, height, STAIR_WIDTH, TREAD_MIXES[index]);
    step.name = `stone-step-${index + 1}`;
    step.position.set(edge + (index + 0.5) * TREAD_DEPTH, bottom + height / 2, STAIR_CENTER_Z);
    stairs.add(step);
    return step;
  });

  // Part of this small pad sits beneath the lowest block, so it visibly has a
  // foot without adding another island or lower terrace.
  const footPad = block(PAD_LENGTH, PAD_HEIGHT, PAD_WIDTH, 0.78);
  footPad.name = 'stone-foot-pad';
  footPad.position.set((padStart + padEnd) / 2, bottom + PAD_HEIGHT / 2, STAIR_CENTER_Z);
  stairs.add(footPad);

  const bounds = { minX: -edge, maxX: padEnd, minZ: -edge, maxZ: edge };

  function lateralLimits(x: number, radius: number) {
    if (x <= padStart) return { min: minZ + radius, max: maxZ - radius };
    // Round the inside corners where the wider pad meets the narrower run.
    const inset = Math.sqrt(Math.max(0, radius * radius - (x - padStart) ** 2));
    return { min: Math.max(padMinZ + radius, minZ + inset), max: Math.min(padMaxZ - radius, maxZ - inset) };
  }

  function supports(x: number, z: number, radius: number) {
    if (x < -edge + radius || x > padEnd - radius || z < -edge + radius || z > edge - radius) return false;
    if (x <= edge - radius) return true;
    if (x >= edge) {
      const limits = lateralLimits(x, radius);
      return z >= limits.min && z <= limits.max;
    }

    // At the two inside corners, the circular footprint can straddle the
    // island and stair tops as long as it does not overlap the void.
    const cornerInset = Math.sqrt(Math.max(0, radius * radius - (edge - x) ** 2));
    return z >= minZ + cornerInset && z <= maxZ - cornerInset;
  }

  function treadIndex(x: number) {
    return Math.min(TREAD_COUNT - 1, Math.max(0, Math.floor((x - edge) / TREAD_DEPTH)));
  }

  function floorHeight(x: number) {
    if (x <= edge) return top;
    return x >= stairEnd ? bottom + PAD_HEIGHT : top - treadIndex(x) * rise;
  }

  function characterHeight(x: number, radius: number) {
    const index = x <= edge ? 0 : treadIndex(x);
    const onPad = x >= stairEnd;
    const floor = floorHeight(x);
    if ((!onPad && index === 0) || radius <= 0) return floor;

    const distance = x - (onPad ? stairEnd : edge + index * TREAD_DEPTH);
    const higher = onPad ? top - (TREAD_COUNT - 1) * rise : floor + rise;
    if (distance < radius) {
      // The character's lower capsule touches the upper tread's edge before
      // its center reaches it, rather than clipping through the riser.
      return Math.max(floor, higher - radius + Math.sqrt(Math.max(0, radius * radius - distance * distance)));
    }

    // A rise slightly taller than the capsule radius needs a brief settling
    // interval after it clears the edge. It is still above the visible stone.
    const settleDistance = Math.min(0.08, Math.max(0, TREAD_DEPTH - radius * 2));
    const heightDifference = higher - floor;
    if (heightDifference > radius && settleDistance > 0 && distance < radius + settleDistance) {
      return floor + (heightDifference - radius) * (1 - (distance - radius) / settleDistance);
    }
    return floor;
  }

  function target(x: number, z: number, radius: number) {
    const targetX = THREE.MathUtils.clamp(x, edge, padEnd - radius);
    const limits = lateralLimits(targetX, radius);
    return {
      x: targetX,
      z: THREE.MathUtils.clamp(z, limits.min, limits.max),
    };
  }

  return { treads, footPad, bounds, supports, floorHeight, characterHeight, target };
}
