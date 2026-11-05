import type { createDayNightCycle } from './createDayNightCycle';
import { DAY_NIGHT_PHASES } from './dayNightPhases';

type DayNightCycle = Pick<ReturnType<typeof createDayNightCycle>, 'setDayNightPhase' | 'update'>;

// A valid phase query pins the lighting for capture; missing or invalid values
// leave the normal cycle running. Other query parameters are untouched.
export function configureDayNightFromUrl(search: string, cycle: DayNightCycle) {
  const requested = new URLSearchParams(search).get('phase');
  const phase = DAY_NIGHT_PHASES.find((candidate) => candidate.name === requested);
  if (phase) cycle.setDayNightPhase(phase.name);

  return (deltaSeconds: number) => cycle.update(phase ? 0 : deltaSeconds);
}
