export const PLAYER_GEOMETRY = {
  radius: 0.4, bodyLength: 0.6, bodyCapSegments: 6, bodyRadialSegments: 12,
  crownOffset: 0.05, crownSpan: 0.7,
  eye: [0.045, 10, 8], eyeXs: [-0.14, 0.14], eyeY: 1.04, eyeZ: 0.38,
  beak: [1, 12, 8], beakScale: [0.13, 0.09, 0.13], beakPosition: [0, 0.85, 0.4],
  shadowSegments: 24, shadowScale: 0.7, shadowLift: 0.04,
  details: {
    oval: [1, 12, 8],
    combXs: [-0.1, 0, 0.1], combY: 0.62, combZ: 0.17, combScale: [0.07, 0.06, 0.07],
    wingPositions: [[-0.36, 0.1, 0], [0.36, 0.1, 0]], wingScale: [0.05, 0.15, 0.11],
  },
} as const;
