import * as THREE from 'three';
import type { CoreComponents, EntityWorld } from '../core/ecs';
import { RAIN_LOOK } from '../weather/rainSettings';

export const WEATHER_MODES = ['clear', 'cloudy', 'rain', 'snow'] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];

export function isWeatherMode(value: unknown): value is WeatherMode {
  return WEATHER_MODES.some((mode) => mode === value);
}

export interface WeatherState {
  mode: WeatherMode;
  rainProgress: number;
  cloudyProgress: number;
  snowProgress: number;
  rainAmount: number;
  cloudyAmount: number;
  snowAmount: number;
}

export interface WeatherComponents extends CoreComponents {
  weather?: WeatherState;
}

export function createWeatherState(): WeatherState {
  return { mode: 'clear', rainProgress: 0, cloudyProgress: 0, snowProgress: 0,
    rainAmount: 0, cloudyAmount: 0, snowAmount: 0 };
}

export function setWeatherMode(state: WeatherState, next: WeatherMode) {
  if (!isWeatherMode(next)) throw new RangeError(`Unknown weather: ${next}`);
  state.mode = next;
}

export function advanceWeather(state: WeatherState, deltaSeconds: number) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
    throw new RangeError('Weather elapsed time must be a finite, non-negative number');
  }
  // Keep the original complementary envelopes and transition time.
  const step = deltaSeconds / RAIN_LOOK.transitionSeconds;
  state.rainProgress = THREE.MathUtils.clamp(state.rainProgress + (state.mode === 'rain' ? step : -step), 0, 1);
  state.cloudyProgress = THREE.MathUtils.clamp(state.cloudyProgress + (state.mode === 'cloudy' ? step : -step), 0, 1);
  state.snowProgress = THREE.MathUtils.clamp(state.snowProgress + (state.mode === 'snow' ? step : -step), 0, 1);
  state.rainAmount = THREE.MathUtils.smoothstep(state.rainProgress, 0, 1);
  state.cloudyAmount = THREE.MathUtils.smoothstep(state.cloudyProgress, 0, 1);
  state.snowAmount = THREE.MathUtils.smoothstep(state.snowProgress, 0, 1);
}

/** Weather receives the full elapsed frame, not the fixed-step catch-up limit. */
export function updateWeatherSystem(world: EntityWorld<WeatherComponents>, deltaSeconds: number) {
  for (const entity of world.with('weather')) advanceWeather(entity.weather, deltaSeconds);
}
