import { GROUND_HEIGHT, ISLAND_BOTTOM } from './createIsland';
import { FARM_PALETTE } from './farmPalette';
import type { FarmPoint } from './farmFootprints';

export interface WaterFeatureSpec {
  stream: { points: FarmPoint[]; width: number; surfaceLift: number };
  bridge: {
    x: number; z: number; length: number; width: number; rotationDegrees: number;
    thickness: number; topLift: number; walkRule: 'walkable' | 'blocked';
  };
  waterfall: { side: 'east' | 'west' | 'north' | 'south'; width: number | null; lipDepth: number; drop: number };
  palette: { stream: number; waterfall: number; bridge: number };
}

// PHASE 1 PLACEHOLDERS ONLY. Look Dev has not supplied the route, sizes, walk
// rule or palette. The last route point must lie on the selected island edge;
// null waterfall width inherits the stream width. Rotation is in degrees about Y.
export const WATER_FEATURE: WaterFeatureSpec = {
  stream: {
    points: [{ x: 5.2, z: -4.25 }, { x: 5.7, z: -5.55 }, { x: 8, z: -5.55 }],
    width: 1.1, surfaceLift: 0.031,
  },
  bridge: {
    x: 7, z: -5.55, length: 3, width: 1.5, rotationDegrees: 90,
    thickness: 0.025, topLift: 0.036, walkRule: 'walkable',
  },
  waterfall: { side: 'east', width: null, lipDepth: 0.2, drop: GROUND_HEIGHT - ISLAND_BOTTOM },
  // Reuse existing colors solely to make the placeholders visible.
  palette: { stream: FARM_PALETTE.pondWater, waterfall: FARM_PALETTE.pondWater, bridge: FARM_PALETTE.barnWood },
};
