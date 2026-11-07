// Look Dev LOCK: Linear EBR-48 comment c6ca07d2. All coordinates are world
// units; surface heights are relative to the existing island top.
export const WATER_FEATURE = {
  stream: {
    points: [
      [3.9, -2.45], [3.9, -1.95], [3.6, -0.8], [3.1, 0.6], [2.85, 2.0],
      [2.9, 3.6], [3.25, 5.3], [3.55, 6.8], [3.6, 8.0],
    ],
    width: 1.2, rimWidth: 1.5, deepWidth: 0.35, foamLength: 0.3, foamWidth: 0.1, foamSpacing: 0.9,
    rimLift: 0.027, waterLift: 0.029, deepLift: 0.030, foamLift: 0.032,
    collisionHalfWidth: 0.63, collisionLength: 1.0, collisionOverlap: 0.05,
    segments: 200, deepWobble: 0.08, wobblePeriods: 6, foamOffsetFactor: 0.3,
  },
  bridge: {
    x: 3.9, z: -1.95, length: 2.0, width: 1.4, topLift: 0.12, gradeLength: 0.3,
    plankCount: 5, gapWidth: 0.04, railHeight: 0.55, postSize: 0.14,
    undersideThickness: 0.06, undersideLift: -0.01, plankThickness: 0.04, gapThickness: 0.002, gapLift: 0.001,
    walkRule: 'walkable',
  },
  waterfall: {
    x: 3.6, width: 1.2, lipDepth: 0.2, faceOffset: 0.06, bottom: -1.2, fadeHeight: 0.8,
    streakWidth: 0.12, streakSpacing: 0.3, speed: 0.25, step: 0.1,
    streakLayerOffset: 0.001, streakPeriod: 1.0, streakLength: 0.6, streakColumnPhase: 0.2,
  },
} as const;
