import { FARM_CONTENT_ID } from '../content/farm';
import type { EntityWorld } from '../core/ecs';
import type { DayNightComponents, WeatherComponents } from '../environment';
import { isWeatherMode, type WeatherMode } from '../environment/weatherSystem';
import type { PlacementKind } from '../placement/grid';
import type { PlacementComponents } from '../placement/placementSystem';

export interface SnapshotComponents extends PlacementComponents, DayNightComponents, WeatherComponents {}

/** Versioned hook shape only: this is not a persistence or loading implementation. */
export interface SaveV1 {
  version: 1;
  contentId: string;
  player: { position: [number, number, number]; yaw: number };
  // Array order is placement/undo order; rotations are quarter turns.
  placed: Array<{ id: string; kind: PlacementKind; cell: [number, number]; rotation: number }>;
  clock: { progress: number; cycleSeconds: number; held: boolean };
  weather: { mode: WeatherMode; rainProgress: number; cloudyProgress: number };
}

// A future persistence adapter may implement this contract. Neither method is
// wired to storage, a startup loader, or a public window API in this slice.
export interface SaveHooks {
  save(): SaveV1;
  load(save: SaveV1): void;
}

function finite(value: number, name: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  // JSON has no negative zero. Canonicalize it so the returned object itself
  // deep-equals its JSON round-trip, even after an externally edited pose.
  return value === 0 ? 0 : value;
}

function integer(value: number, name: string) {
  const result = finite(value, name);
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return result;
}

function progress(value: number, name: string, exclusiveEnd = false) {
  const result = finite(value, name);
  if (result < 0 || result > 1 || (exclusiveEnd && result === 1)) throw new RangeError(`${name} is out of range`);
  return result;
}

function only<T>(items: readonly T[], label: string): T {
  if (items.length !== 1) throw new Error(`Expected exactly one ${label}`);
  return items[0];
}

/** Describe the live engine world as detached, finite, JSON-round-trippable data. */
export function snapshot(world: EntityWorld<SnapshotComponents>, contentId: string = FARM_CONTENT_ID): SaveV1 {
  if (typeof contentId !== 'string' || !contentId.length) throw new TypeError('contentId must be a non-empty string');
  const player = only([...world.with('character', 'transform')], 'player').transform;
  const clock = only([...world.with('dayNight')], 'clock').dayNight;
  const weather = only([...world.with('weather')], 'weather').weather;
  if (!isWeatherMode(weather.mode)) throw new RangeError('Unknown weather mode');
  if (typeof clock.held !== 'boolean') throw new TypeError('clock.held must be boolean');
  const cycleSeconds = finite(clock.cycleSeconds, 'clock.cycleSeconds');
  if (cycleSeconds <= 0) throw new RangeError('clock.cycleSeconds must be positive');

  const items = [...world.with('placed')];
  for (const item of items) integer(item.placed.sequence, 'placed.sequence');
  items.sort((a, b) => a.placed.sequence - b.placed.sequence);
  if (items.some((item, index) => index > 0 && item.placed.sequence === items[index - 1].placed.sequence)) {
    throw new Error('Placement order must be unique');
  }
  const placed: SaveV1['placed'] = items.map(({ id, placed }) => {
    if (typeof id !== 'string' || !id.length) throw new TypeError('placed.id must be a non-empty string');
    if (placed.kind !== 'fence' && placed.kind !== 'plot') throw new RangeError('Unknown placed kind');
    const rotation = integer(placed.rotation, 'placed.rotation');
    if (rotation > 3) throw new RangeError('placed.rotation must be a quarter turn');
    return { id, kind: placed.kind,
      cell: [integer(placed.area.cell.column, 'placed.cell.column'), integer(placed.area.cell.row, 'placed.cell.row')], rotation };
  });

  return {
    version: 1,
    contentId,
    player: { position: [finite(player.position[0], 'player.x'), finite(player.position[1], 'player.y'),
      finite(player.position[2], 'player.z')], yaw: finite(player.yaw, 'player.yaw') },
    placed,
    clock: { progress: progress(clock.progress, 'clock.progress', true), cycleSeconds, held: clock.held },
    weather: { mode: weather.mode, rainProgress: progress(weather.rainProgress, 'weather.rainProgress'),
      cloudyProgress: progress(weather.cloudyProgress, 'weather.cloudyProgress') },
  };
}
