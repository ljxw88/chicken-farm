import * as THREE from 'three';
import type { FarmObstacle } from '../scene/farmCollisions';
import { CLOUDY_LOOK } from './cloudySettings';
import { createRainEffect } from './createRainEffect';
import { RAIN_LOOK } from './rainSettings';

export const WEATHER_MODES = ['clear', 'cloudy', 'rain'] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];

export function isWeatherMode(value: unknown): value is WeatherMode {
  return WEATHER_MODES.some((mode) => mode === value);
}

interface WeatherSystemOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  anchor: THREE.Object3D;
  groundHeight: number;
  groundSize: number;
  splashExclusions: readonly FarmObstacle[];
  setDirectionalIntensityMultiplier: (multiplier: number) => void;
  setAmbientHemisphereColorMultiplier: (red: number, green: number, blue: number) => void;
  setShadowWeather?: (rain: number, cloudy: number) => void;
  random?: () => number;
}

export function createWeatherSystem(options: WeatherSystemOptions) {
  const rain = createRainEffect(options);
  let mode: WeatherMode = 'clear';
  let rainProgress = 0;
  let cloudyProgress = 0;
  let rainAmount = 0;
  let cloudyAmount = 0;
  let disposed = false;
  options.setDirectionalIntensityMultiplier(1);
  options.setAmbientHemisphereColorMultiplier(1, 1, 1);

  function setWeather(next: WeatherMode) {
    if (!isWeatherMode(next)) throw new RangeError(`Unknown weather: ${next}`);
    mode = next;
  }

  function getWeather() {
    return { mode, rainAmount, cloudyAmount };
  }

  function update(deltaSeconds: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Weather elapsed time must be a finite, non-negative number');
    }
    // Both envelopes use the existing rain transition time, so a direct
    // rain/cloudy crossfade remains complementary even when reversed midway.
    const step = deltaSeconds / RAIN_LOOK.transitionSeconds;
    rainProgress = THREE.MathUtils.clamp(rainProgress + (mode === 'rain' ? step : -step), 0, 1);
    cloudyProgress = THREE.MathUtils.clamp(cloudyProgress + (mode === 'cloudy' ? step : -step), 0, 1);
    rainAmount = THREE.MathUtils.smoothstep(rainProgress, 0, 1);
    cloudyAmount = THREE.MathUtils.smoothstep(cloudyProgress, 0, 1);
    const directionalMultiplier = 1 + (RAIN_LOOK.directionalMultiplier - 1) * rainAmount +
      (CLOUDY_LOOK.directionalMultiplier - 1) * cloudyAmount;
    options.setDirectionalIntensityMultiplier(directionalMultiplier);
    const gains = CLOUDY_LOOK.ambientHemisphereColorGains;
    options.setAmbientHemisphereColorMultiplier(
      THREE.MathUtils.lerp(1, gains.red, cloudyAmount),
      THREE.MathUtils.lerp(1, gains.green, cloudyAmount),
      THREE.MathUtils.lerp(1, gains.blue, cloudyAmount),
    );
    options.setShadowWeather?.(rainAmount, cloudyAmount);
    rain.update(deltaSeconds, rainAmount);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mode = 'clear';
    rainProgress = 0;
    cloudyProgress = 0;
    rainAmount = 0;
    cloudyAmount = 0;
    rain.dispose();
    options.setDirectionalIntensityMultiplier(1);
    options.setAmbientHemisphereColorMultiplier(1, 1, 1);
    options.setShadowWeather?.(0, 0);
  }

  return { setWeather, getWeather, update, dispose };
}
