export const PLAYER_GEOMETRY = {
  radius: 0.4, bodyLength: 0.6, bodyCapSegments: 6, bodyRadialSegments: 12,
  crownOffset: 0.05, crownSpan: 0.7,
  eye: [0.045, 10, 8], eyeXs: [-0.14, 0.14], eyeY: 1.04, eyeZ: 0.38,
  beak: [1, 12, 8], beakScale: [0.13, 0.09, 0.13], beakPosition: [0, 0.85, 0.4],
  shadowSegments: 24, shadowScale: 0.7, shadowLift: 0.04,
} as const;
