import * as THREE from 'three';
import type { FarmObstacle } from '../character/farmCollisions';
import { createVisualRandom } from '../effects/createVisualRandom';
import { advanceWeather, createWeatherState, setWeatherMode, type WeatherMode, type WeatherState } from '../environment/weatherSystem';
import { CLOUDY_LOOK } from './cloudySettings';
import { createRainEffect } from './createRainEffect';
import { createSnow, SNOW_LOOK } from './createSnow';
import { RAIN_LOOK } from './rainSettings';

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
  // Derive a separate snow stream from rain's first existing draw, without
  // consuming any extra values or reshuffling seeded rain and splash positions.
  const random = options.random ?? Math.random;
  let snowSeed = 0;
  let sampled = false;
  const rain = createRainEffect({ ...options, random: () => {
    const value = random();
    if (!sampled) {
      snowSeed = (Math.floor(value * 0x100000000) ^ 0x534e4f57) >>> 0;
      sampled = true;
    }
    return value;
  } });
  const state = options.state ?? createWeatherState();
  let snow: ReturnType<typeof createSnow> | undefined;
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

  function update(deltaSeconds: number, nightAmount = 0) {
    advanceWeather(state, deltaSeconds);
    render(deltaSeconds, nightAmount);
  }

  function render(deltaSeconds: number, nightAmount = 0) {
    const { rainAmount, cloudyAmount, snowAmount } = state;
    const overcastAmount = cloudyAmount + snowAmount;
    const directionalMultiplier = 1 + (RAIN_LOOK.directionalMultiplier - 1) * rainAmount +
      (CLOUDY_LOOK.directionalMultiplier - 1) * overcastAmount;
    options.setDirectionalIntensityMultiplier(directionalMultiplier);
    const gains = CLOUDY_LOOK.ambientHemisphereColorGains;
    options.setAmbientHemisphereColorMultiplier(
      THREE.MathUtils.lerp(1, gains.red, overcastAmount),
      THREE.MathUtils.lerp(1, gains.green, overcastAmount),
      THREE.MathUtils.lerp(1, gains.blue, cloudyAmount) + (gains.blue * SNOW_LOOK.ambientBlueMultiplier - 1) * snowAmount,
    );
    options.setShadowWeather?.(rainAmount, overcastAmount);
    rain.update(deltaSeconds, rainAmount);
    if (!snow && snowAmount > 0) snow = createSnow({ ...options, random: createVisualRandom(snowSeed) });
    snow?.update(deltaSeconds, snowAmount, nightAmount);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    Object.assign(state, createWeatherState());
    rain.dispose();
    snow?.dispose();
    options.setDirectionalIntensityMultiplier(1);
    options.setAmbientHemisphereColorMultiplier(1, 1, 1);
    options.setShadowWeather?.(0, 0);
  }

  return { setWeather, getWeather, getSnowAmount: () => state.snowAmount, update, render, dispose };
}
