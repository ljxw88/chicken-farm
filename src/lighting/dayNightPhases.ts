// Keep the signed colors and key light; reduce the flat fill so the key's
// direction is visible. Intermediate lighting is interpolated from these values.
export const DAY_NIGHT_PHASES = [
  {
    name: 'morning',
    sky: 0xe8d4c8,
    fog: 0xe8d4c8,
    fogDensity: 0.012,
    ambient: 0xf0e0d0,
    ambientIntensity: 0.16,
    hemisphereSky: 0xe8d4c8,
    hemisphereGround: 0xa8c090,
    hemisphereIntensity: 0.35,
    directional: 0xffe8c8,
    directionalIntensity: 0.55,
    nightLights: 0,
  },
  {
    name: 'daytime',
    sky: 0xa8d4f0,
    fog: 0xc8e0f0,
    fogDensity: 0.006,
    ambient: 0xe8f0e8,
    ambientIntensity: 0.1,
    hemisphereSky: 0xa8d4f0,
    hemisphereGround: 0x9cb88a,
    hemisphereIntensity: 0.55,
    directional: 0xfff2d6,
    directionalIntensity: 1.1,
    nightLights: 0,
  },
  {
    name: 'sunset',
    sky: 0xf0a878,
    fog: 0xe89870,
    fogDensity: 0.015,
    ambient: 0xe89870,
    ambientIntensity: 0.12,
    hemisphereSky: 0xf0a878,
    hemisphereGround: 0xc89070,
    hemisphereIntensity: 0.2,
    directional: 0xff8a50,
    directionalIntensity: 0.65,
    nightLights: 0,
  },
  {
    name: 'night',
    sky: 0x2a2848,
    fog: 0x1e2430,
    fogDensity: 0.02,
    ambient: 0x3a4560,
    ambientIntensity: 0.18,
    hemisphereSky: 0x2a2848,
    hemisphereGround: 0x1e2430,
    hemisphereIntensity: 0.22,
    directional: 0xc8d4f0,
    directionalIntensity: 0.22,
    nightLights: 1,
  },
] as const;

export type DayNightPhaseName = (typeof DAY_NIGHT_PHASES)[number]['name'];

export const DEFAULT_DAY_NIGHT_CYCLE_SECONDS = 72;
export const WINDOW_LIGHT = { color: 0xffcc88, intensity: 0.85, distance: 7, decay: 2 } as const;
// The visible glass keeps its original glow, but the nearby point light must
// not overwhelm the moon or light the whole body like a camera flash.
export const LANTERN_LIGHT = { color: 0xffb060, intensity: 0.08, distance: 2, decay: 2, glassIntensity: 0.55 } as const;
