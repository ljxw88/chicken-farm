import type { FarmObstacle } from '../scene/farmCollisions';
import { boxPolygon, polygonsOverlap } from '../scene/farmFootprints';

// The existing fence is 1.47 units wide, including its posts. One tile leaves
// a tiny gap between neighbouring segments without changing their proportions.
export const TILE_SIZE = 1.5;
export type PlacementKind = 'fence' | 'plot';

export interface Cell {
  column: number;
  row: number;
}

export interface Footprint {
  cell: Cell;
  columns: number;
  rows: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
}

export function createGrid(groundSize: number) {
  const count = Math.floor(groundSize / TILE_SIZE);
  // Centre the complete tiles. Partial edge strips are visible but unbuildable.
  const min = -count * TILE_SIZE / 2;
  const max = -min;

  function cellAt(x: number, z: number): Cell {
    return { column: Math.floor((x - min) / TILE_SIZE), row: Math.floor((z - min) / TILE_SIZE) };
  }

  function footprint(cell: Cell, kind: PlacementKind, rotation: number): Footprint {
    const sideways = kind === 'plot' && rotation % 2 !== 0;
    const columns = kind === 'plot' && !sideways ? 2 : 1;
    const rows = sideways ? 2 : 1;
    const minX = min + cell.column * TILE_SIZE;
    const minZ = min + cell.row * TILE_SIZE;
    const maxX = minX + columns * TILE_SIZE;
    const maxZ = minZ + rows * TILE_SIZE;
    return { cell, columns, rows, minX, maxX, minZ, maxZ, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
  }

  function contains(area: Footprint) {
    return area.cell.column >= 0 && area.cell.row >= 0 &&
      area.cell.column + area.columns <= count && area.cell.row + area.rows <= count;
  }

  return { count, min, max, cellAt, footprint, contains };
}

export function cellKey(cell: Cell) {
  return `${cell.column},${cell.row}`;
}

export function footprintCells(area: Footprint): Cell[] {
  const cells: Cell[] = [];
  for (let column = area.cell.column; column < area.cell.column + area.columns; column++) {
    for (let row = area.cell.row; row < area.cell.row + area.rows; row++) cells.push({ column, row });
  }
  return cells;
}

/** Test the full reserved tile area, not just the narrow fence collision box. */
export function intersectsFootprint(area: Footprint, obstacle: FarmObstacle) {
  if (obstacle.kind === 'polygon') return polygonsOverlap(boxPolygon(area), obstacle.points);
  if (obstacle.kind === 'box') {
    return area.minX < obstacle.maxX && area.maxX > obstacle.minX &&
      area.minZ < obstacle.maxZ && area.maxZ > obstacle.minZ;
  }
  const x = Math.max(area.minX, Math.min(obstacle.x, area.maxX));
  const z = Math.max(area.minZ, Math.min(obstacle.z, area.maxZ));
  return (x - obstacle.x) ** 2 + (z - obstacle.z) ** 2 <= obstacle.radius ** 2;
}

/** Only the fence is solid; the plot is a walkable ground surface. */
export function fenceCollision(area: Footprint, rotation: number, name: string): FarmObstacle {
  const halfX = rotation % 2 === 0 ? 0.735 : 0.13;
  const halfZ = rotation % 2 === 0 ? 0.13 : 0.735;
  return {
    kind: 'box', name,
    minX: area.centerX - halfX, maxX: area.centerX + halfX,
    minZ: area.centerZ - halfZ, maxZ: area.centerZ + halfZ,
  };
}
