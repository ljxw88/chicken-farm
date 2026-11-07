/** Plain placement data; appearance remains in the render factories and slots. */
export type CellOffset = readonly [column: number, row: number];

export interface Placeable {
  readonly id: string;
  readonly assetId: string;
  /** Visual bounds in world units: width, height, depth. */
  readonly size: readonly [number, number, number];
  readonly footprint: readonly CellOffset[];
  /** Offset of the reference cell from the unrotated mask's minimum corner. */
  readonly anchor: CellOffset;
  readonly visualOffset: readonly [number, number, number];
  readonly blocking: 'solid' | 'walkable';
  readonly blocksPlacement: boolean;
  readonly collider:
    | { readonly type: 'none' }
    | { readonly type: 'cells' }
    | { readonly type: 'box'; readonly width: number; readonly depth: number };
}

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && Number.isSafeInteger(value[0]) && Number.isSafeInteger(value[1]);
}

function triple(value: unknown, positive = false): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && [value[0], value[1], value[2]].every((number) =>
    typeof number === 'number' && Number.isFinite(number) && (!positive || number > 0));
}

/** Reject malformed authored data before it can affect placement or collision. */
export function validatePlaceables(value: unknown): asserts value is Readonly<Record<string, Placeable>> {
  if (!record(value) || !Object.keys(value).length) throw new TypeError('Placeables must be a non-empty registry');
  const ids = new Set<string>();
  for (const [key, entry] of Object.entries(value)) {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id.trim()) throw new TypeError(`Invalid placeable id: ${key}`);
    if (ids.has(entry.id)) throw new RangeError(`Duplicate placeable id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.id !== key) throw new RangeError(`Placeable key does not match id: ${key}`);
    if (typeof entry.assetId !== 'string' || !entry.assetId.trim()) throw new TypeError(`Invalid asset id: ${key}`);
    if (!triple(entry.size, true) || !triple(entry.visualOffset)) throw new TypeError(`Invalid visual size or offset: ${key}`);
    if (!pair(entry.anchor)) throw new TypeError(`Invalid anchor: ${key}`);
    if (!Array.isArray(entry.footprint) || !entry.footprint.length) throw new TypeError(`Empty footprint: ${key}`);
    const cells = new Set<string>();
    let minColumn = Infinity, minRow = Infinity;
    for (const cell of entry.footprint) {
      if (!pair(cell)) throw new TypeError(`Invalid footprint cell: ${key}`);
      const cellKey = `${cell[0]},${cell[1]}`;
      if (cells.has(cellKey)) throw new RangeError(`Duplicate footprint cell: ${key}`);
      cells.add(cellKey);
      minColumn = Math.min(minColumn, cell[0]);
      minRow = Math.min(minRow, cell[1]);
    }
    if (minColumn !== -entry.anchor[0] || minRow !== -entry.anchor[1]) {
      throw new RangeError(`Anchor must be relative to the footprint minimum: ${key}`);
    }
    if (typeof entry.blocksPlacement !== 'boolean' || typeof entry.blocking !== 'string' ||
      !['solid', 'walkable'].includes(entry.blocking) || !record(entry.collider) ||
      typeof entry.collider.type !== 'string' || !['none', 'cells', 'box'].includes(entry.collider.type)) {
      throw new TypeError(`Invalid blocking or collider: ${key}`);
    }
    if ((entry.blocking === 'walkable') !== (entry.collider.type === 'none')) {
      throw new RangeError(`Collider does not match blocking rule: ${key}`);
    }
    if (entry.collider.type === 'box' && (!Number.isFinite(entry.collider.width) || Number(entry.collider.width) <= 0 ||
      !Number.isFinite(entry.collider.depth) || Number(entry.collider.depth) <= 0)) {
      throw new TypeError(`Invalid box collider: ${key}`);
    }
  }
}

function definePlaceables<const T extends Readonly<Record<string, Placeable>>>(entries: T): T {
  validatePlaceables(entries);
  return entries;
}

export const PLACEABLES = definePlaceables({
  fence: {
    id: 'fence', assetId: 'fence', size: [1.47, 0.95, 0.215], footprint: [[0, 0]], anchor: [0, 0],
    visualOffset: [0, 0, 0], blocking: 'solid', blocksPlacement: true,
    collider: { type: 'box', width: 1.47, depth: 0.26 },
  },
  plot: {
    id: 'plot', assetId: 'plot', size: [2.94, 0.31, 1.44], footprint: [[0, 0], [1, 0]], anchor: [0, 0],
    visualOffset: [0, 0, 0], blocking: 'walkable', blocksPlacement: true, collider: { type: 'none' },
  },
} as const);

export type PlaceableId = keyof typeof PLACEABLES;

/** Compatibility dimensions for legacy renderers that still require rectangles. */
export function rectangleDimensions(placeable: Placeable) {
  const columns = Math.max(...placeable.footprint.map(([column]) => column)) + placeable.anchor[0] + 1;
  const rows = Math.max(...placeable.footprint.map(([, row]) => row)) + placeable.anchor[1] + 1;
  if (columns * rows !== placeable.footprint.length) throw new RangeError(`Footprint is not a rectangle: ${placeable.id}`);
  return { columns, rows };
}
