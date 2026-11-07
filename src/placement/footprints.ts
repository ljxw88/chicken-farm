import type { Placeable } from '../content/placeables';
import type { Cell } from './grid';

/** Rotate the mask, keeping its bounding-corner reference at the selected cell. */
export function rotatedCells(shape: Pick<Placeable, 'footprint' | 'anchor'>, selected: Cell, rotation: number): Cell[] {
  if (!Number.isSafeInteger(selected.column) || !Number.isSafeInteger(selected.row) || !Number.isSafeInteger(rotation)) {
    throw new TypeError('Selected cell and rotation must be safe integers');
  }
  if (!shape.footprint.length) throw new RangeError('Footprint cannot be empty');
  const turns = ((rotation % 4) + 4) % 4;
  const rotated = shape.footprint.map(([column, row]) => {
    for (let turn = 0; turn < turns; turn++) [column, row] = [row, -column];
    return { column, row };
  });
  const minColumn = Math.min(...rotated.map((cell) => cell.column));
  const minRow = Math.min(...rotated.map((cell) => cell.row));
  return rotated.map(({ column, row }) => {
    const dc = column - minColumn, dr = row - minRow;
    const offsetColumn = dc - shape.anchor[0], offsetRow = dr - shape.anchor[1];
    const c = selected.column + offsetColumn, r = selected.row + offsetRow;
    if (![dc, dr, offsetColumn, offsetRow, c, r].every(Number.isSafeInteger)) throw new RangeError('Rotated cell is out of range');
    return { column: c === 0 ? 0 : c, row: r === 0 ? 0 : r };
  }).sort((a, b) => a.column - b.column || a.row - b.row);
}
