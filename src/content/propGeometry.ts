// Procedural prop dimensions and placements. Material colours/opacity are in
// slots.ts; these values do not change when a Look Dev slot is swapped.
export const PATH_GEOMETRY = {
  segments: 200, widthWave: 0.08, waveCount: 5, endSegments: 20, endLift: 0.001,
  edgeWidth: 1.34, edgeLift: 0.02, surfaceWidth: 1.2, surfaceLift: 0.024,
  highlightPositions: [0.055, 0.1, 0.145, 0.19, 0.235, 0.28, 0.33, 0.39, 0.46, 0.53, 0.61, 0.7, 0.8, 0.9],
  highlightOffsets: [0.38, -0.32, 0.18], highlightEdgeClearance: 0.15,
  highlightLongWidth: 0.19, highlightWidth: 0.13, highlightDepth: 0.065,
  highlightAngle: 0.2, highlightLift: 0.027,
} as const;

export const TREE_GEOMETRY = {
  trunk: [0.14, 0.24, 1.5, 7], crown: [1, 1], trunkY: 0.75, crownHeightScale: 0.8,
  shadowRadius: 0.8, shadowSegments: 16, shadowScale: 0.72, shadowLift: 0.003,
  clusters: [
    [0, 2.05, 0, 0.85, 0], [-0.4, 1.95, 0.1, 0.62, 1],
    [0.4, 1.98, -0.1, 0.62, 2], [0.02, 2.4, 0, 0.5, 1],
  ],
  collisionRadius: 0.32, shelterRadius: 1.02,
} as const;

export const POND_GEOMETRY = {
  outline: [1, 0.96, 1.04, 1.02, 0.95, 1.03, 1.04, 0.95, 1.02, 1.05, 0.96, 1.02, 1.04, 0.96],
  rimLift: 0.027, waterLift: 0.029, deepRadiusX: 0.85, deepRadiusZ: 0.5, deepLift: 0.03,
  deepX: 0.2, deepZ: -0.08, rippleWidth: 0.035, rippleLift: 0.032,
  ripples: [[-0.55, 0.15, 0.43], [0.25, -0.25, 0.55], [0.65, 0.3, 0.3]],
  collisionMarginFactor: 0.525,
} as const;

export const GRASS_GEOMETRY = {
  blade: [0.055, 0.28, 3], centerlineSamples: 400, streamClearance: 0.9, lift: 0.13, rotationStep: 0.7,
  offsets: [[-0.08, 0, 0.22], [0.07, 0.03, -0.25], [0, -0.08, 0.08]],
} as const;
