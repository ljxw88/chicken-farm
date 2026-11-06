import { DAY_NIGHT_PHASES } from './lighting/dayNightPhases';
import type { DayNightPhaseName } from './lighting';
import { isWeatherMode } from './weather';

// An optional 32-bit visual seed leaves the existing weather RNG unchanged.
export function parseVisualSeed(search: string) {
  const value = new URLSearchParams(search).get('seed');
  if (value === null || !/^[+-]?\d+$/.test(value)) return undefined;
  const seed = Number(value);
  return Number.isSafeInteger(seed) ? seed >>> 0 : undefined;
}

export function parseStartupOptions(search: string) {
  const params = new URLSearchParams(search);
  const weather = params.get('weather');
  const phase = params.get('phase');
  return {
    weather: isWeatherMode(weather) ? weather : undefined,
    phase: DAY_NIGHT_PHASES.find((candidate) => candidate.name === phase)?.name,
  };
}

interface PhaseCycle {
  update: (deltaSeconds: number) => void;
  setDayNightPhase: (phase: DayNightPhaseName) => void;
  setDayNightCycleSeconds: (seconds: number) => void;
}

export function createStartupPhaseController(cycle: PhaseCycle, phase: DayNightPhaseName | undefined) {
  // A URL phase is held for repeatable Nest captures; ordinary sessions keep cycling.
  let held = phase !== undefined;
  if (phase) cycle.setDayNightPhase(phase);

  function update(deltaSeconds: number) {
    if (!held) cycle.update(deltaSeconds);
  }

  function setDayNightPhase(next: DayNightPhaseName) {
    cycle.setDayNightPhase(next);
    held = false;
  }

  function setDayNightCycleSeconds(seconds: number) {
    cycle.setDayNightCycleSeconds(seconds);
    held = false;
  }

  return { update, setDayNightPhase, setDayNightCycleSeconds };
}
