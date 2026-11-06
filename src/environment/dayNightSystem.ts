import type { CoreComponents, EntityWorld } from '../core/ecs';
import { DAY_NIGHT_PHASES, DEFAULT_DAY_NIGHT_CYCLE_SECONDS, type DayNightPhaseName } from '../lighting/dayNightPhases';

export interface DayNightState {
  progress: number;
  cycleSeconds: number;
  held: boolean;
}

export interface DayNightComponents extends CoreComponents {
  dayNight?: DayNightState;
}

export function createDayNightState(): DayNightState {
  return { progress: 0, cycleSeconds: DEFAULT_DAY_NIGHT_CYCLE_SECONDS, held: false };
}

export function advanceDayNight(state: DayNightState, deltaSeconds: number) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('Day/night elapsed time must be a finite, non-negative number');
  }
  state.progress = (state.progress + (deltaSeconds % state.cycleSeconds) / state.cycleSeconds) % 1;
}

export function setCycleSeconds(state: DayNightState, seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError('Day/night cycle length must be a finite number greater than zero');
  }
  state.cycleSeconds = seconds;
}

export function setPhase(state: DayNightState, name: DayNightPhaseName) {
  const index = DAY_NIGHT_PHASES.findIndex((phase) => phase.name === name);
  if (index < 0) throw new RangeError(`Unknown day/night phase: ${name}`);
  state.progress = index / DAY_NIGHT_PHASES.length;
}

/** The clock remains frame-timed: a URL-pinned phase does not advance. */
export function updateDayNightSystem(world: EntityWorld<DayNightComponents>, deltaSeconds: number) {
  for (const entity of world.with('dayNight')) {
    if (!entity.dayNight.held) advanceDayNight(entity.dayNight, deltaSeconds);
  }
}
