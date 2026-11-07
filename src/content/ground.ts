import { GRID, ISLAND } from './world';

export type Terrain = 'free' | 'path' | 'water' | 'locked';
export type GroundPoint = readonly [number, number];

export interface GroundLand {
  readonly min: GroundPoint;
  readonly max: GroundPoint;
  readonly height: number;
}

export interface GroundCellRange {
  readonly min: GroundPoint;
  readonly maxExclusive: GroundPoint;
  readonly terrain: Terrain;
}

export interface GroundChunk {
  readonly id: string;
  readonly land: readonly GroundLand[];
  readonly cells: readonly GroundCellRange[];
}

export interface GroundDefinition {
  readonly tileSize: number;
  readonly origin: GroundPoint;
  readonly chunks: readonly GroundChunk[];
}

const count = Math.floor(ISLAND.size / GRID.tileSize);
const gridMin = -count * GRID.tileSize / 2;
const edge = ISLAND.size / 2;

/** The visible half-unit strips are land, but are not complete placement cells. */
export const GROUND = {
  tileSize: GRID.tileSize,
  origin: [gridMin, gridMin],
  chunks: [{
    id: 'island-0',
    land: [{ min: [-edge, -edge], max: [edge, edge], height: ISLAND.groundHeight }],
    cells: [{ min: [0, 0], maxExclusive: [count, count], terrain: 'free' }],
  }],
} as const satisfies GroundDefinition;
