import { DAY_NIGHT_PHASES } from './lighting/dayNightPhases';
import type { DayNightPhaseName } from './lighting';
import { isWeatherMode } from './weather';

export function parseStartupOptions(search: string) {
  const params = new URLSearchParams(search);
  const weather = params.get('weather');
  const phase = params.get('phase');
  return {
    weather: isWeatherMode(weather) ? weather : undefined,
    phase: DAY_NIGHT_PHASES.find((candidate) => candidate.name === phase)?.name,
  };
}

// Optional visual seed: without it the existing weather keeps its default RNG.
export function parseVisualSeed(search: string) {
  const value = new URLSearchParams(search).get('seed');
  if (value === null || !/^(?:\d+|0x[\da-f]+)$/i.test(value)) return undefined;
  const seed = Number(value);
  return Number.isSafeInteger(seed) && seed <= 0xffffffff ? seed : undefined;
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
