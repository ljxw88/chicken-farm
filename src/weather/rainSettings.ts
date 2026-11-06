// Look Dev visually approved the rain starting targets; they are not explicitly LOCKED.
// The shared 1.75-second weather transition is LOCKED for EBR-40.
// Streak length is world-space;
// the eventual 1x3–5 px pixel-art treatment is intentionally not implemented here.
export const RAIN_LOOK = {
  transitionSeconds: 1.75,
  directionalMultiplier: 0.8,
  color: 0xb8cfda,
  opacity: 0.35,
  streakCount: 240,
  streakTiltDegrees: 15,
  streakLengthMin: 0.075,
  streakLengthMax: 0.095,
  fieldWidth: 24,
  fieldHeight: 10,
  fallSpeedMin: 4,
  fallSpeedMax: 5,
  splashCapacity: 6,
  splashChancePerImpact: 0.035,
  splashRadiusMin: 0.08,
  splashRadiusMax: 0.18,
  splashInnerRadiusRatio: 0.9,
  splashSegments: 16,
  splashLifetimeMin: 0.25,
  splashLifetimeMax: 0.4,
  splashOpacity: 0.32,
  splashHeight: 0.036,
  splashSafetyMargin: 0.05,
  maxSplashFrameSeconds: 0.5,
} as const;
