// A single upper-left key is shared by all phases. These are light colors,
// not changes to the signed farm palette; intermediate values interpolate.
export const DAY_NIGHT_PHASES = [
  {
    name: 'morning',
    sky: 0xe8d4c8,
    fog: 0xe8d4c8,
    fogDensity: 0.012,
    ambient: 0xf0e0d0,
    ambientIntensity: 0.2,
    hemisphereSky: 0xe8d4c8,
    hemisphereGround: 0xa8c090,
    hemisphereIntensity: 0.25,
    directional: 0xffe8c8,
    directionalIntensity: 2.35,
    shadowOffset: 0.48,
    shadowOpacity: 0.22,
    nightLights: 0,
  },
  {
    name: 'daytime',
    sky: 0xa8d4f0,
    fog: 0xc8e0f0,
    fogDensity: 0.006,
    ambient: 0xe8f0e8,
    ambientIntensity: 0.07,
    hemisphereSky: 0xa8d4f0,
    hemisphereGround: 0x9cb88a,
    hemisphereIntensity: 0.35,
    directional: 0xfff2d6,
    directionalIntensity: 1.8,
    // The 0.266-unit length stays fixed as the approved azimuth rotates.
    shadowOffset: 0.266,
    shadowOpacity: 0.22,
    nightLights: 0,
  },
  {
    name: 'sunset',
    sky: 0xf0a878,
    fog: 0xe89870,
    fogDensity: 0.0129,
    // Keep a warm sunset without turning the signed green grass olive or the
    // blue pond grey. Key colour and the material palette remain unchanged.
    ambient: 0xeadbc8,
    ambientIntensity: 0.08,
    hemisphereSky: 0xe8dec6,
    hemisphereGround: 0xb5b99a,
    hemisphereIntensity: 0.2,
    directional: 0xffeddb,
    directionalIntensity: 1.38,
    shadowOffset: 0.48,
    shadowOpacity: 0.22,
    nightLights: 0,
  },
  {
    name: 'night',
    sky: 0x2a2848,
    fog: 0x1e2430,
    fogDensity: 0.02,
    ambient: 0xaeb8c9,
    ambientIntensity: 0.26,
    hemisphereSky: 0x2a2848,
    hemisphereGround: 0x1e2430,
    hemisphereIntensity: 0.11,
    directional: 0xc8d4f0,
    directionalIntensity: 0.52,
    shadowOffset: 0.16,
    shadowOpacity: 0.09,
    nightLights: 1,
  },
] as const;

export type DayNightPhaseName = (typeof DAY_NIGHT_PHASES)[number]['name'];

export const DEFAULT_DAY_NIGHT_CYCLE_SECONDS = 72;
export const WINDOW_LIGHT = { color: 0xffcc88, intensity: 0.85, distance: 7, decay: 2 } as const;
// Engineer: restore the signed 3.5 range while keeping the face below the moon-lit crown.
export const LANTERN_LIGHT = { color: 0xffb060, intensity: 0.12, distance: 3.5, decay: 2, glassIntensity: 0.55 } as const;
