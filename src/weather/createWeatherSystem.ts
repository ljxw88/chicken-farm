import * as THREE from 'three';
import type { FarmObstacle } from '../character/farmCollisions';
import { advanceWeather, createWeatherState, setWeatherMode, type WeatherMode, type WeatherState } from '../environment/weatherSystem';
import { CLOUDY_LOOK } from '../content/cloudySettings';
import { createRainEffect } from './createRainEffect';
import { RAIN_LOOK } from '../content/rainSettings';

export { WEATHER_MODES, isWeatherMode } from '../environment/weatherSystem';
export type { WeatherMode } from '../environment/weatherSystem';

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
  state?: WeatherState;
}

export function createWeatherSystem(options: WeatherSystemOptions) {
  const rain = createRainEffect(options);
  const state = options.state ?? createWeatherState();
  let disposed = false;
  options.setDirectionalIntensityMultiplier(1);
  options.setAmbientHemisphereColorMultiplier(1, 1, 1);

  function setWeather(next: WeatherMode) {
    setWeatherMode(state, next);
  }

  function getWeather() {
    const { mode, rainAmount, cloudyAmount } = state;
    return { mode, rainAmount, cloudyAmount };
  }

  function update(deltaSeconds: number) {
    advanceWeather(state, deltaSeconds);
    render(deltaSeconds);
  }

  function render(deltaSeconds: number) {
    const { rainAmount, cloudyAmount } = state;
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
    Object.assign(state, createWeatherState());
    rain.dispose();
    options.setDirectionalIntensityMultiplier(1);
    options.setAmbientHemisphereColorMultiplier(1, 1, 1);
    options.setShadowWeather?.(0, 0);
  }

  return { setWeather, getWeather, update, render, dispose };
}
