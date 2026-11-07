import { ART_SLOTS } from './slots';

// EBR-64 Look Dev targets. At the default pixel pass these widths are 1–2 pixels.
export const SNOW_LOOK = {
  flakeCount: 160,
  sizeMin: 0.11,
  sizeMax: 0.22,
  fieldWidth: 19,
  fieldHeight: 8,
  fallSpeedMin: 0.8,
  fallSpeedMax: 1.4,
  swayAmplitude: 0.3,
  swayPeriodMin: 3,
  swayPeriodMax: 5,
  windX: 0.8,
  windZ: -0.6,
  windDriftPerFall: 0.12,
  color: ART_SLOTS.palette.snow.color,
  opacity: ART_SLOTS.prop.snow.opacity,
  nightOpacityMultiplier: ART_SLOTS.prop.snow.nightOpacityMultiplier,
  ambientBlueMultiplier: ART_SLOTS.light.weather.snowAmbientBlueMultiplier,
} as const;
