import { PLACEABLES, rectangleDimensions } from './placeables';

// All world dimensions and placement footprints are independent of art slots.
export const ISLAND = {
  size: 16,
  groundHeight: 2.4,
  bottom: 0,
  clearAlpha: 1,
  grassLipDepth: 0.16,
  soilDepth: 0.6,
  stairAssetId: 'prop.stair',
  cliff: { columns: 32, grassRows: 1, soilRows: 2, rockRows: 4, seedStep: 157, xJitter: 0.55, yJitter: 0.35 },
} as const;

export const STAIR = {
  centerZ: 0.75,
  width: 1.2,
  treadDepth: 0.9,
  treadCount: 5,
  padLength: 1.5,
  padWidth: 1.6,
  padHeight: 0.16,
  padOverlap: 0.45,
  edgeDepth: 0.18,
  entryTolerance: 0.001,
  entryInset: 0.00001,
} as const;

export const GRID = {
  tileSize: 1.5,
  footprints: { fence: rectangleDimensions(PLACEABLES.fence), plot: rectangleDimensions(PLACEABLES.plot) },
  fenceCollision: { halfLength: PLACEABLES.fence.collider.width / 2, halfWidth: PLACEABLES.fence.collider.depth / 2 },
} as const;
