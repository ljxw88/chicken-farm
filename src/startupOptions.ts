import { DAY_NIGHT_PHASES, DEFAULT_DAY_NIGHT_CYCLE_SECONDS } from './content/dayNight';
import type { DayNightPhaseName } from './lighting';
import { isWeatherMode } from './weather';
import { STARTUP_OPTIONS } from './content/startup';
import { DEFAULT_SEASON, type Season } from './content/slots';

// The only alternate is selected at construction time; unknown values keep spring.
export function parseSeason(search: string): Season {
  return new URLSearchParams(search).get(STARTUP_OPTIONS.seasonKey) === 'autumn' ? 'autumn' : DEFAULT_SEASON;
}

// Preserve the sheepfold's signed integer seed and 32-bit wrap behavior.
export function parseSheepSeed(search: string) {
  const value = new URLSearchParams(search).get(STARTUP_OPTIONS.seedKey);
  if (value === null || !/^[+-]?\d+$/.test(value)) return undefined;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed >>> 0 : undefined;
}

export function parseStartupOptions(search: string) {
  const params = new URLSearchParams(search);
  const weather = params.get(STARTUP_OPTIONS.weatherKey);
  const phase = params.get(STARTUP_OPTIONS.phaseKey);
  return {
    weather: isWeatherMode(weather) ? weather : undefined,
    phase: DAY_NIGHT_PHASES.find((candidate) => candidate.name === phase)?.name,
  };
}

// Optional visual seed: without it the existing weather keeps its default RNG.
export function parseVisualSeed(search: string) {
  const value = new URLSearchParams(search).get(STARTUP_OPTIONS.seedKey);
  if (value === null || !/^(?:\d+|0x[\da-f]+)$/i.test(value)) return undefined;
  const seed = Number(value);
  return Number.isSafeInteger(seed) && seed <= STARTUP_OPTIONS.maxVisualSeed ? seed : undefined;
}

interface PhaseCycle {
  update: (deltaSeconds: number) => void;
  setDayNightPhase: (phase: DayNightPhaseName) => void;
  setDayNightCycleSeconds: (seconds: number) => void;
  getPhase: () => DayNightPhaseName;
  setHeld: (held: boolean) => void;
  isHeld: () => boolean;
}

interface PhaseControllerOptions {
  cycleSeconds?: number;
  getCycleSeconds?: () => number;
  now?: () => number;
}

export function createStartupPhaseController(
  cycle: PhaseCycle,
  phase: DayNightPhaseName | undefined,
  options: PhaseControllerOptions = {},
) {
  // A URL phase is held for repeatable Nest captures; ordinary sessions keep cycling.
  let cycleSeconds = options.cycleSeconds ?? DEFAULT_DAY_NIGHT_CYCLE_SECONDS;
  let resumedAt: number | undefined;
  cycle.setHeld(phase !== undefined);
  if (options.cycleSeconds !== undefined) cycle.setDayNightCycleSeconds(cycleSeconds);
  if (phase) cycle.setDayNightPhase(phase);

  function frameDelta(deltaSeconds: number) {
    if (cycle.isHeld()) return deltaSeconds;
    // Do not count a suspended frame's paused time when following is resumed.
    const elapsed = resumedAt === undefined || !options.now
      ? deltaSeconds
      : Math.min(deltaSeconds, Math.max(0, (options.now() - resumedAt) / 1000));
    resumedAt = undefined;
    return elapsed;
  }

  function update(deltaSeconds: number) {
    if (!cycle.isHeld()) cycle.update(frameDelta(deltaSeconds));
  }

  function setFollowing(following: boolean) {
    if (typeof following !== 'boolean') throw new TypeError('Following must be a boolean');
    if (following && cycle.isHeld()) resumedAt = options.now?.();
    if (!following) resumedAt = undefined;
    cycle.setHeld(!following);
  }

  function setDayNightPhase(next: DayNightPhaseName) {
    cycle.setDayNightPhase(next);
    // Keep the existing console setter's event-time semantics.
    resumedAt = undefined;
    cycle.setHeld(false);
  }

  function setDayNightCycleSeconds(seconds: number) {
    cycle.setDayNightCycleSeconds(seconds);
    cycleSeconds = seconds;
    resumedAt = undefined;
    cycle.setHeld(false);
  }

  function getState() {
    return { phase: cycle.getPhase(), following: !cycle.isHeld(), cycleSeconds: options.getCycleSeconds?.() ?? cycleSeconds };
  }

  return { update, frameDelta, setDayNightPhase, setDayNightCycleSeconds, setFollowing, getState };
}
