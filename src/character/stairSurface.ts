import type { FarmBounds } from './farmCollisions';
import { STAIR } from '../content/world';

// These dimensions describe both the visible blocks and their walkable union.
export const STAIR_CENTER_Z = STAIR.centerZ;
export const STAIR_WIDTH = STAIR.width;
export const TREAD_DEPTH = STAIR.treadDepth;
export const TREAD_COUNT = STAIR.treadCount;
export const PAD_LENGTH = STAIR.padLength;
export const PAD_WIDTH = STAIR.padWidth;
export const PAD_HEIGHT = STAIR.padHeight;
export const PAD_OVERLAP = STAIR.padOverlap;

// At the island-to-stair seam, a previously supported footprint can be a
// fraction outside the opening after a long pad-side/key sequence. Only slide
// offsets within 0.001 world units; never widen the actual supported surface.
const TOP_ENTRY_TOLERANCE = 0.001;
const TOP_ENTRY_INSET = 0.00001;

export interface StairSurface {
  edge: number;
  stairEnd: number;
  padStart: number;
  padEnd: number;
  minZ: number;
  maxZ: number;
  padMinZ: number;
  padMaxZ: number;
  rise: number;
  top: number;
  bottom: number;
  bounds: FarmBounds;
}

export function createStairSurface(size: number, top: number, bottom: number): StairSurface {
  const edge = size / 2;
  const stairEnd = edge + TREAD_COUNT * TREAD_DEPTH;
  const padStart = stairEnd - PAD_OVERLAP;
  const padEnd = padStart + PAD_LENGTH;
  const minZ = STAIR_CENTER_Z - STAIR_WIDTH / 2;
  const maxZ = STAIR_CENTER_Z + STAIR_WIDTH / 2;
  const padMinZ = STAIR_CENTER_Z - PAD_WIDTH / 2;
  const padMaxZ = STAIR_CENTER_Z + PAD_WIDTH / 2;
  const rise = (top - bottom) / TREAD_COUNT;
  return { edge, stairEnd, padStart, padEnd, minZ, maxZ, padMinZ, padMaxZ, rise, top, bottom,
    bounds: { minX: -edge, maxX: padEnd, minZ: -edge, maxZ: edge } };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function lateralLimits(surface: StairSurface, x: number, radius: number) {
  const { padStart, minZ, maxZ, padMinZ, padMaxZ } = surface;
  if (x <= padStart) return { min: minZ + radius, max: maxZ - radius };
  // Round the inside corners where the wider pad meets the narrower run.
  const inset = Math.sqrt(Math.max(0, radius * radius - (x - padStart) ** 2));
  return { min: Math.max(padMinZ + radius, minZ + inset), max: Math.min(padMaxZ - radius, maxZ - inset) };
}

export function stairSupports(surface: StairSurface, x: number, z: number, radius: number) {
  const { edge, padEnd, minZ, maxZ } = surface;
  if (x < -edge + radius || x > padEnd - radius || z < -edge + radius || z > edge - radius) return false;
  if (x <= edge - radius) return true;
  if (x >= edge) {
    const limits = lateralLimits(surface, x, radius);
    return z >= limits.min && z <= limits.max;
  }

  // The footprint may straddle the island and stair tops, but not the void.
  const cornerInset = Math.sqrt(Math.max(0, radius * radius - (edge - x) ** 2));
  return z >= minZ + cornerInset && z <= maxZ - cornerInset;
}

export function slideStairPadCorner(surface: StairSurface, x: number, z: number, radius: number, distance: number) {
  const { padStart, minZ, maxZ } = surface;
  if (x < padStart || x > padStart + radius || distance <= 0) return undefined;
  const openingZ = clamp(z, minZ + radius, maxZ - radius);
  const offset = openingZ - z;
  if (offset === 0) return undefined;
  return { x, z: z + Math.sign(offset) * Math.min(Math.abs(offset), distance) };
}

export function slideStairTopEntry(surface: StairSurface, x: number, z: number, radius: number, distance: number) {
  const { edge, minZ, maxZ } = surface;
  if (x < edge - radius || x > edge || distance <= 0) return undefined;
  const min = minZ + radius;
  const max = maxZ - radius;
  if (min > max) return undefined;
  if (z >= min && z <= max) return undefined;
  const openingZ = clamp(z, min, max);
  if (Math.abs(openingZ - z) > TOP_ENTRY_TOLERANCE) return undefined;
  const inset = Math.min(TOP_ENTRY_INSET, Math.max(0, (max - min) / 2));
  const offset = clamp(z, min + inset, max - inset) - z;
  return { x, z: z + Math.sign(offset) * Math.min(Math.abs(offset), distance) };
}

function treadIndex(surface: StairSurface, x: number) {
  return Math.min(TREAD_COUNT - 1, Math.max(0, Math.floor((x - surface.edge) / TREAD_DEPTH)));
}

export function stairFloorHeight(surface: StairSurface, x: number) {
  const { edge, stairEnd, top, bottom, rise } = surface;
  if (x <= edge) return top;
  return x >= stairEnd ? bottom + PAD_HEIGHT : top - treadIndex(surface, x) * rise;
}

export function stairCharacterHeight(surface: StairSurface, x: number, radius: number) {
  const { edge, stairEnd, top, rise } = surface;
  const index = x <= edge ? 0 : treadIndex(surface, x);
  const onPad = x >= stairEnd;
  const floor = stairFloorHeight(surface, x);
  if ((!onPad && index === 0) || radius <= 0) return floor;

  const distance = x - (onPad ? stairEnd : edge + index * TREAD_DEPTH);
  const higher = onPad ? top - (TREAD_COUNT - 1) * rise : floor + rise;
  if (distance < radius) {
    // The lower capsule touches the upper edge before its center reaches it.
    return Math.max(floor, higher - radius + Math.sqrt(Math.max(0, radius * radius - distance * distance)));
  }

  const settleDistance = Math.min(0.08, Math.max(0, TREAD_DEPTH - radius * 2));
  const heightDifference = higher - floor;
  if (heightDifference > radius && settleDistance > 0 && distance < radius + settleDistance) {
    return floor + (heightDifference - radius) * (1 - (distance - radius) / settleDistance);
  }
  return floor;
}

export function stairTarget(surface: StairSurface, x: number, z: number, radius: number) {
  const targetX = clamp(x, surface.edge, surface.padEnd - radius);
  const limits = lateralLimits(surface, targetX, radius);
  return { x: targetX, z: clamp(z, limits.min, limits.max) };
}
