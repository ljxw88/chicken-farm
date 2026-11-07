import { GRID } from './world';
import { VISUAL_SEEDS } from './startup';

// Layout and collision reservations are independent of the appearance slots.
export const DEFAULT_SHEEP_SEED = VISUAL_SEEDS.sheep;
export const SHEEPFOLD = {
  fenceAssetId: 'fence', shelterAssetId: 'building.sheepfold', sheepAssetId: 'prop.sheep',
  x: -4.7, z: 4.6, width: 3 * GRID.tileSize, depth: 2 * GRID.tileSize,
  shelterZ: 3.94, sheepZ: 4.35, sheepOffsetX: 1.4, sheepRadius: 0.4,
} as const;

export const LEAN_TO = { width: 1.4, depth: 1.2, height: 1.1, rise: 0.3, overhang: 0.12 } as const;

export const SHEEPFOLD_GEOMETRY = {
  backColumns: [-1, 0, 1], frontColumns: [-1, 1], sides: [-1, 1], rows: [-1, 1], variants: [0, 1],
  frontBackInset: 0.1, sideInset: 0.08,
  shadowRadius: 1, shadowSegments: 20, shadowLift: 0.035,
  fenceShadowScale: [0.73, 0.18], shelterShadowScale: [0.8, 0.7], sheepShadowScale: [0.34, 0.25],
  fenceShadowOffset: 0.35, shelterShadowOffset: 1.2, sheepShadowOffset: 0.9, sheepShadowExtra: 0.12,
} as const;

export const LEAN_TO_GEOMETRY = {
  backWidthInset: 0.24, backHeight: 0.95, backDepth: 0.1, backY: 0.475, backZInset: 0.05,
  sideInset: 0.12, sideTopInset: 0.11, sideThickness: 0.1, sideXInset: 0.05,
  postZInset: 0.06, postTopInset: 0.1, postSize: 0.12, postXInset: 0.06,
  roofThickness: 0.1,
} as const;

export const SHEEP_GEOMETRY = {
  turnDegrees: [-20, -25], woolGeometry: [1, 1],
  woolLobes: [
    [[0, 0.48, -0.165, 0.28, 0.27, 0.28], [-0.005, 0.49, 0, 0.29, 0.27, 0.28],
      [0, 0.48, 0.165, 0.28, 0.27, 0.28]],
    [[-0.015, 0.48, -0.17, 0.275, 0.27, 0.275], [0.01, 0.49, -0.02, 0.285, 0.27, 0.28],
      [0.005, 0.48, 0.17, 0.28, 0.27, 0.275]],
  ],
  leg: [0.24, 0.32, 0.24], legXs: [-0.16, 0.16], legZs: [-0.22, 0.22], legY: 0.16, secondRearLegZ: -0.14,
  headPosition: [0, 0.54, 0.4], face: [0.36, 0.32, 0.36], facePosition: [0, -0.055, 0.2],
  ear: [0.12, 0.12, 0.14], earXs: [-0.23, 0.23], earY: 0.015, earZ: 0.15,
  nose: [0.16, 0.1, 0.1], nosePosition: [0, -0.13, 0.43],
  nodPeriod: 4, nodDegrees: 12,
} as const;
