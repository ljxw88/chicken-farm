import { GROUND, type GroundChunk, type GroundDefinition, type GroundLand, type Terrain } from '../content/ground';
import type { FarmBounds } from '../character/farmCollisions';
import type { Cell } from '../placement/grid';

export type GroundState = Terrain | 'void' | 'blocked' | 'plot';
export type OccupantKind = 'blocker' | 'plot' | 'path' | 'water';

export interface GroundOccupant {
  readonly id: string;
  readonly kind: OccupantKind;
  readonly blocksPlacement: boolean;
  readonly cells: readonly Cell[];
}

export interface GroundCell {
  readonly cell: Cell;
  /** Original chunk terrain, before path/water and occupancy overlays. */
  readonly base: Terrain | 'void';
  readonly terrain: Terrain | 'void';
  readonly state: GroundState;
  readonly owners: readonly string[];
}

export type GroundChange =
  | { readonly type: 'chunk-added'; readonly id: string; readonly cells: readonly Cell[] }
  | { readonly type: 'occupant-set' | 'occupant-removed'; readonly id: string; readonly cells: readonly Cell[] };

type Listener = (change: GroundChange) => void;
const terrainNames: readonly string[] = ['free', 'path', 'water', 'locked'];
const occupantKinds: readonly string[] = ['blocker', 'plot', 'path', 'water'];
const MAX_CELLS_PER_CHUNK = 1_000_000;

function key({ column, row }: Cell) { return `${column},${row}`; }
function validCell(cell: Cell) {
  return Boolean(cell && Number.isSafeInteger(cell.column) && Number.isSafeInteger(cell.row));
}
function sorted(cells: readonly Cell[]) {
  return cells.map(({ column, row }) => ({ column: column === 0 ? 0 : column, row: row === 0 ? 0 : row }))
    .sort((a, b) => a.column - b.column || a.row - b.row);
}
function isPoint(value: unknown, integer: boolean): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && [value[0], value[1]].every((number) =>
    typeof number === 'number' && Number.isFinite(number) && (!integer || Number.isSafeInteger(number)));
}
function validBounds(bounds: FarmBounds) {
  return bounds && [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite) &&
    bounds.minX < bounds.maxX && bounds.minZ < bounds.maxZ;
}
function unionBounds(bounds: readonly FarmBounds[]): FarmBounds | undefined {
  if (!bounds.length) return undefined;
  return {
    minX: Math.min(...bounds.map((item) => item.minX)), maxX: Math.max(...bounds.map((item) => item.maxX)),
    minZ: Math.min(...bounds.map((item) => item.minZ)), maxZ: Math.max(...bounds.map((item) => item.maxZ)),
  };
}

/** Whether the complete cell is covered by rectangles at one height, including seams. */
function covered(cell: FarmBounds, land: readonly GroundLand[]) {
  for (const height of new Set(land.map((item) => item.height))) {
    const sameHeight = land.filter((item) => item.height === height && item.max[0] > cell.minX &&
      item.min[0] < cell.maxX && item.max[1] > cell.minZ && item.min[1] < cell.maxZ);
    const xs = new Set([cell.minX, cell.maxX]);
    for (const item of sameHeight) {
      xs.add(Math.max(cell.minX, item.min[0]));
      xs.add(Math.min(cell.maxX, item.max[0]));
    }
    const edges = [...xs].sort((a, b) => a - b);
    let complete = true;
    for (let i = 1; i < edges.length && complete; i++) {
      const start = edges[i - 1], end = edges[i];
      if (end <= start) continue;
      const intervals = sameHeight.filter((item) => item.min[0] <= start && item.max[0] >= end)
        .map((item) => [Math.max(cell.minZ, item.min[1]), Math.min(cell.maxZ, item.max[1])] as const)
        .sort((a, b) => a[0] - b[0]);
      let coveredZ = cell.minZ;
      for (const [min, max] of intervals) {
        if (min > coveredZ) break;
        coveredZ = Math.max(coveredZ, max);
      }
      if (coveredZ < cell.maxZ) complete = false;
    }
    if (complete) return true;
  }
  return false;
}

/** Plain cell/occupancy service. It does not own Three.js objects or render terrain. */
export function createGroundGrid(definition: GroundDefinition = GROUND, extraSupport?: FarmBounds) {
  if (!definition || !Number.isFinite(definition.tileSize) || definition.tileSize <= 0 || !isPoint(definition.origin, false) ||
    !Array.isArray(definition.chunks)) throw new TypeError('Invalid ground definition');
  if (extraSupport && !validBounds(extraSupport)) throw new TypeError('Invalid extra support bounds');
  const tileSize = definition.tileSize;
  const origin: [number, number] = [...definition.origin];
  const support = extraSupport && { ...extraSupport };
  const chunks = new Map<string, GroundChunk>();
  const terrain = new Map<string, { cell: Cell; base: Terrain }>();
  const land: GroundLand[] = [];
  const occupants = new Map<string, GroundOccupant>();
  const byCell = new Map<string, Set<string>>();
  const listeners = new Set<Listener>();

  function cellAt(x: number, z: number): Cell {
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('World coordinates must be finite');
    const cell = { column: Math.floor((x - origin[0]) / tileSize), row: Math.floor((z - origin[1]) / tileSize) };
    if (!validCell(cell)) throw new RangeError('World coordinates exceed the cell range');
    return { column: cell.column === 0 ? 0 : cell.column, row: cell.row === 0 ? 0 : cell.row };
  }

  function cellBounds(cell: Cell): FarmBounds {
    if (!validCell(cell)) throw new TypeError('Cell coordinates must be safe integers');
    const minX = origin[0] + cell.column * tileSize, minZ = origin[1] + cell.row * tileSize;
    const result = { minX, maxX: minX + tileSize, minZ, maxZ: minZ + tileSize };
    if (!validBounds(result)) throw new RangeError('Cell bounds are out of range');
    return result;
  }

  function notify(change: GroundChange) {
    for (const listener of listeners) listener({ ...change, cells: sorted(change.cells) });
  }

  function addChunk(chunk: GroundChunk) {
    if (!chunk || typeof chunk.id !== 'string' || !chunk.id.trim() || !Array.isArray(chunk.land) || !Array.isArray(chunk.cells)) {
      throw new TypeError('Invalid ground chunk');
    }
    if (chunks.has(chunk.id)) throw new RangeError(`Duplicate ground chunk: ${chunk.id}`);
    if (!chunk.land.length && !chunk.cells.length) throw new TypeError('Ground chunk is empty');
    const newLand: GroundLand[] = chunk.land.map((item) => {
      if (!item || !isPoint(item.min, false) || !isPoint(item.max, false) || !Number.isFinite(item.height) ||
        item.min[0] >= item.max[0] || item.min[1] >= item.max[1]) throw new TypeError('Invalid land rectangle');
      return { min: [item.min[0], item.min[1]], max: [item.max[0], item.max[1]], height: item.height };
    });
    const added = new Map<string, { cell: Cell; base: Terrain }>();
    let count = 0;
    for (const range of chunk.cells) {
      if (!range || !isPoint(range.min, true) || !isPoint(range.maxExclusive, true) ||
        range.min[0] >= range.maxExclusive[0] || range.min[1] >= range.maxExclusive[1] || !terrainNames.includes(range.terrain)) {
        throw new TypeError('Invalid ground cell range');
      }
      const size = (range.maxExclusive[0] - range.min[0]) * (range.maxExclusive[1] - range.min[1]);
      count += size;
      if (!Number.isSafeInteger(size) || count > MAX_CELLS_PER_CHUNK) throw new RangeError('Ground chunk has too many cells');
      for (let column = range.min[0]; column < range.maxExclusive[0]; column++) {
        for (let row = range.min[1]; row < range.maxExclusive[1]; row++) {
          const cell = { column: column === 0 ? 0 : column, row: row === 0 ? 0 : row };
          const cellKey = key(cell);
          if (terrain.has(cellKey) || added.has(cellKey)) throw new RangeError(`Duplicate ground cell: ${cellKey}`);
          if (range.terrain !== 'locked' && !covered(cellBounds(cell), [...land, ...newLand])) {
            throw new RangeError(`Ground cell is not fully supported: ${cellKey}`);
          }
          added.set(cellKey, { cell, base: range.terrain });
        }
      }
    }
    // All validation finishes before any visible state changes.
    const saved: GroundChunk = { id: chunk.id, land: newLand, cells: chunk.cells.map((range) => ({
      min: [range.min[0], range.min[1]], maxExclusive: [range.maxExclusive[0], range.maxExclusive[1]], terrain: range.terrain,
    })) };
    chunks.set(saved.id, saved);
    land.push(...newLand);
    for (const [cellKey, value] of added) terrain.set(cellKey, value);
    notify({ type: 'chunk-added', id: saved.id, cells: [...added.values()].map(({ cell }) => cell) });
  }

  function removeFromIndex(item: GroundOccupant) {
    for (const cell of item.cells) {
      const cellKey = key(cell), owners = byCell.get(cellKey);
      owners?.delete(item.id);
      if (!owners?.size) byCell.delete(cellKey);
    }
  }

  function setOccupant(item: GroundOccupant) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || !occupantKinds.includes(item.kind) ||
      typeof item.blocksPlacement !== 'boolean' || !Array.isArray(item.cells)) throw new TypeError('Invalid ground occupant');
    if ((item.kind === 'water' && !item.blocksPlacement) || (item.kind === 'path' && item.blocksPlacement)) {
      throw new RangeError('Path and water occupancy flags are inconsistent');
    }
    const seen = new Set<string>();
    for (const cell of item.cells) {
      if (!validCell(cell)) throw new TypeError('Occupant cells must be safe integers');
      if (seen.has(key(cell))) throw new RangeError(`Duplicate occupant cell: ${key(cell)}`);
      seen.add(key(cell));
    }
    const saved: GroundOccupant = { id: item.id, kind: item.kind, blocksPlacement: item.blocksPlacement, cells: sorted(item.cells) };
    const old = occupants.get(item.id);
    if (old && old.kind === saved.kind && old.blocksPlacement === saved.blocksPlacement && old.cells.length === saved.cells.length &&
      old.cells.every((cell, index) => cell.column === saved.cells[index].column && cell.row === saved.cells[index].row)) return;
    if (old) removeFromIndex(old);
    occupants.set(saved.id, saved);
    for (const cell of saved.cells) {
      const cellKey = key(cell), owners = byCell.get(cellKey) ?? new Set<string>();
      owners.add(saved.id);
      byCell.set(cellKey, owners);
    }
    const changed = new Map([...old?.cells ?? [], ...saved.cells].map((cell) => [key(cell), cell]));
    notify({ type: 'occupant-set', id: saved.id, cells: [...changed.values()] });
  }

  function removeOccupant(id: string) {
    const item = occupants.get(id);
    if (!item) return false;
    removeFromIndex(item);
    occupants.delete(id);
    notify({ type: 'occupant-removed', id, cells: item.cells });
    return true;
  }

  function getCell(cell: Cell): GroundCell {
    if (!validCell(cell)) throw new TypeError('Cell coordinates must be safe integers');
    const cellKey = key(cell), base = terrain.get(cellKey)?.base ?? 'void';
    const owners = [...byCell.get(cellKey) ?? []];
    const entries = owners.map((id) => occupants.get(id)!);
    const surface = base === 'void' || base === 'locked' ? base :
      base === 'water' || entries.some((item) => item.kind === 'water') ? 'water' :
        base === 'path' || entries.some((item) => item.kind === 'path') ? 'path' : 'free';
    const state: GroundState = surface === 'void' || surface === 'locked' ? surface :
      entries.some((item) => item.kind === 'blocker' && item.blocksPlacement) ? 'blocked' :
        entries.some((item) => item.kind === 'plot' && item.blocksPlacement) ? 'plot' : surface;
    return { cell: { column: cell.column === 0 ? 0 : cell.column, row: cell.row === 0 ? 0 : cell.row },
      base, terrain: surface, state, owners };
  }

  function bounds() {
    const landBounds = unionBounds(land.map((item) => ({ minX: item.min[0], maxX: item.max[0], minZ: item.min[1], maxZ: item.max[1] })));
    return { land: landBounds, support: unionBounds([...(landBounds ? [landBounds] : []), ...(support ? [support] : [])]) };
  }

  function onChange(listener: Listener) {
    if (typeof listener !== 'function') throw new TypeError('Ground listener must be a function');
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  for (const chunk of definition.chunks) addChunk(chunk);
  return {
    tileSize, origin: [...origin] as [number, number], cellAt, cellBounds, getCell, addChunk, bounds, onChange,
    cells: () => sorted([...terrain.values()].map(({ cell }) => cell)),
    chunkIds: () => [...chunks.keys()], setOccupant, removeOccupant,
    getOccupant: (id: string) => {
      const item = occupants.get(id);
      return item && { ...item, cells: sorted(item.cells) };
    },
  };
}

export type GroundGrid = ReturnType<typeof createGroundGrid>;
