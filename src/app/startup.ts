import { FOLLOW_DAY_NIGHT_CYCLE_SECONDS } from '../content/dayNight';
import { createStartupPhaseController, parseStartupOptions } from '../startupOptions';
import type { AppContext } from './context';

export function registerStartup(context: AppContext) {
  const startup = parseStartupOptions(window.location.search);
  const phaseController = createStartupPhaseController(context.dayNight, startup.phase, {
    cycleSeconds: FOLLOW_DAY_NIGHT_CYCLE_SECONDS,
    getCycleSeconds: () => context.environment.dayNight!.cycleSeconds,
    now: () => performance.now(),
  });
  context.phaseController = phaseController;
  if (startup.weather) context.weather.setWeather(startup.weather);
  context.setDayNightCycleSeconds = phaseController.setDayNightCycleSeconds;
  context.setDayNightPhase = phaseController.setDayNightPhase;
  context.setDayNightFollowing = phaseController.setFollowing;
  context.getDayNightState = phaseController.getState;
  context.setWeather = context.weather.setWeather;
  context.getWeather = context.weather.getWeather;
  window.setDayNightCycleSeconds = context.setDayNightCycleSeconds;
  window.setDayNightPhase = context.setDayNightPhase;
  window.setDayNightFollowing = context.setDayNightFollowing;
  window.getDayNightState = context.getDayNightState;
  window.setWeather = context.setWeather;
  window.getWeather = context.getWeather;
}
