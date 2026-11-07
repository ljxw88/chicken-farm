import { createStartupPhaseController, parseStartupOptions } from '../startupOptions';
import type { AppContext } from './context';

export function registerStartup(context: AppContext) {
  const startup = parseStartupOptions(window.location.search);
  const phaseController = createStartupPhaseController(context.dayNight, startup.phase);
  context.phaseController = phaseController;
  if (startup.weather) context.weather.setWeather(startup.weather);
  context.setDayNightCycleSeconds = phaseController.setDayNightCycleSeconds;
  context.setDayNightPhase = phaseController.setDayNightPhase;
  context.setWeather = context.weather.setWeather;
  context.getWeather = context.weather.getWeather;
  window.setDayNightCycleSeconds = context.setDayNightCycleSeconds;
  window.setDayNightPhase = context.setDayNightPhase;
  window.setWeather = context.setWeather;
  window.getWeather = context.getWeather;
}
