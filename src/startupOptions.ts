import { DAY_NIGHT_PHASES, DEFAULT_DAY_NIGHT_CYCLE_SECONDS } from './lighting/dayNightPhases';
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
  getPhase: () => DayNightPhaseName;
}

interface PhaseControllerOptions {
  cycleSeconds?: number;
  now?: () => number;
}

export function createStartupPhaseController(
  cycle: PhaseCycle,
  phase: DayNightPhaseName | undefined,
  options: PhaseControllerOptions = {},
) {
  // A URL phase is held for repeatable Nest captures; ordinary sessions keep cycling.
  let held = phase !== undefined;
  let cycleSeconds = options.cycleSeconds ?? DEFAULT_DAY_NIGHT_CYCLE_SECONDS;
  let resumedAt: number | undefined;
  if (options.cycleSeconds !== undefined) cycle.setDayNightCycleSeconds(cycleSeconds);
  if (phase) cycle.setDayNightPhase(phase);

  function update(deltaSeconds: number) {
    if (held) return;
    // Do not count a suspended frame's paused time when following is resumed.
    const elapsed = resumedAt === undefined || !options.now
      ? deltaSeconds
      : Math.min(deltaSeconds, Math.max(0, (options.now() - resumedAt) / 1000));
    resumedAt = undefined;
    cycle.update(elapsed);
  }

  function setFollowing(following: boolean) {
    if (typeof following !== 'boolean') throw new TypeError('Following must be a boolean');
    if (following && held) resumedAt = options.now?.();
    if (!following) resumedAt = undefined;
    held = !following;
  }

  function setDayNightPhase(next: DayNightPhaseName) {
    cycle.setDayNightPhase(next);
    setFollowing(true);
  }

  function setDayNightCycleSeconds(seconds: number) {
    cycle.setDayNightCycleSeconds(seconds);
    cycleSeconds = seconds;
    setFollowing(true);
  }

  function getState() {
    return { phase: cycle.getPhase(), following: !held, cycleSeconds };
  }

  return { update, setDayNightPhase, setDayNightCycleSeconds, setFollowing, getState };
}
