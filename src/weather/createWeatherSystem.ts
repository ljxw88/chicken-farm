import * as THREE from 'three';
import type { FarmObstacle } from '../scene/farmCollisions';
import { createRainEffect } from './createRainEffect';
import { RAIN_LOOK } from './rainSettings';

export type WeatherMode = 'clear' | 'rain';

interface WeatherSystemOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  anchor: THREE.Object3D;
  groundHeight: number;
  groundSize: number;
  splashExclusions: readonly FarmObstacle[];
  setDirectionalIntensityMultiplier: (multiplier: number) => void;
  random?: () => number;
}

export function createWeatherSystem(options: WeatherSystemOptions) {
  const rain = createRainEffect(options);
  let mode: WeatherMode = 'clear';
  let progress = 0;
  let rainAmount = 0;
  let disposed = false;
  options.setDirectionalIntensityMultiplier(1);

  function setWeather(next: WeatherMode) {
    if (next !== 'clear' && next !== 'rain') throw new RangeError(`Unknown weather: ${next}`);
    mode = next;
  }

  function getWeather() {
    return { mode, rainAmount };
  }

  function update(deltaSeconds: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Weather elapsed time must be a finite, non-negative number');
    }
    const direction = mode === 'rain' ? 1 : -1;
    progress = THREE.MathUtils.clamp(progress + direction * deltaSeconds / RAIN_LOOK.transitionSeconds, 0, 1);
    rainAmount = THREE.MathUtils.smoothstep(progress, 0, 1);
    options.setDirectionalIntensityMultiplier(THREE.MathUtils.lerp(1, RAIN_LOOK.directionalMultiplier, rainAmount));
    rain.update(deltaSeconds, rainAmount);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mode = 'clear';
    progress = 0;
    rainAmount = 0;
    rain.dispose();
    options.setDirectionalIntensityMultiplier(1);
  }

  return { setWeather, getWeather, update, dispose };
}
