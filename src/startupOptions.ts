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

interface PhaseCycle {
  update: (deltaSeconds: number) => void;
  setDayNightPhase: (phase: DayNightPhaseName) => void;
  setDayNightCycleSeconds: (seconds: number) => void;
  setHeld: (held: boolean) => void;
  isHeld: () => boolean;
}

export function createStartupPhaseController(cycle: PhaseCycle, phase: DayNightPhaseName | undefined) {
  // A URL phase is held for repeatable Nest captures; ordinary sessions keep cycling.
  cycle.setHeld(phase !== undefined);
  if (phase) cycle.setDayNightPhase(phase);

  function update(deltaSeconds: number) {
    if (!cycle.isHeld()) cycle.update(deltaSeconds);
  }

  function setDayNightPhase(next: DayNightPhaseName) {
    cycle.setDayNightPhase(next);
    cycle.setHeld(false);
  }

  function setDayNightCycleSeconds(seconds: number) {
    cycle.setDayNightCycleSeconds(seconds);
    cycle.setHeld(false);
  }

  return { update, setDayNightPhase, setDayNightCycleSeconds };
}
