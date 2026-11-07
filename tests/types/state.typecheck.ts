import type { Vector3 } from 'three';
import type { EntityWorld } from '../../src/core/ecs';
import { snapshot, type SaveHooks, type SaveV1, type SnapshotComponents } from '../../src/state';

const valid: SaveV1 = {
  version: 1, contentId: 'farm-v1', player: { position: [0, 2.4, 0], yaw: 0 },
  placed: [{ id: 'entity-1', kind: 'fence', cell: [1, 2], rotation: 1 }],
  clock: { progress: 0.25, cycleSeconds: 72, held: false },
  weather: { mode: 'rain', rainProgress: 0.5, cloudyProgress: 0, snowProgress: 0 },
};
const hooks: SaveHooks = { save: () => valid, load: (save) => { void save; } };
const snowWeather: SaveV1['weather'] = { mode: 'snow', rainProgress: 0, cloudyProgress: 0, snowProgress: 0.5 };
declare const world: EntityWorld<SnapshotComponents>;
const described: SaveV1 = snapshot(world);

// @ts-expect-error Unsupported save version.
const badVersion: SaveV1['version'] = 2;
// @ts-expect-error Player positions are three numbers.
const shortPosition: SaveV1['player']['position'] = [0, 0];
// @ts-expect-error Three.js objects are not snapshot positions.
const objectPosition: SaveV1['player']['position'] = {} as Vector3;
// @ts-expect-error Weather modes are closed and type checked.
const badWeather: SaveV1['weather']['mode'] = 'storm';
// @ts-expect-error Snow transition progress is part of the snapshot.
const missingSnow: SaveV1['weather'] = { mode: 'snow', rainProgress: 0, cloudyProgress: 0 };
// @ts-expect-error Placement kinds are closed and type checked.
const badKind: SaveV1['placed'][number]['kind'] = 'tree';
// @ts-expect-error Every placed record has a stable ID.
const missingId: SaveV1['placed'][number] = { kind: 'plot', cell: [1, 2], rotation: 0 };
// @ts-expect-error Save hooks return data, not a function.
const badHook: SaveHooks = { save: () => () => valid, load: () => {} };

void [hooks, snowWeather, described, badVersion, shortPosition, objectPosition, badWeather, missingSnow, badKind, missingId, badHook];
