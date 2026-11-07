export const CHICKEN_GEOMETRY = {
  oval: [1, 12, 8], body: [0, 0.44, 0, 0.4, 0.34, 0.48], head: [0, 0.78, 0.27, 0.27, 0.28, 0.27],
  wing: [0.34, 0.46, -0.05, 0.12, 0.2, 0.28], eye: [0.12, 0.83, 0.5, 0.035, 0.035, 0.035],
  leg: [0.035, 0.035, 0.2, 6], legPosition: [0.15, 0.13, 0.02],
  combZ: [0.16, 0.28, 0.4], combY: 1.05, combScale: [0.08, 0.105, 0.08],
  beak: [0.09, 0.2, 4], beakPosition: [0, 0.72, 0.57],
  shadowRadius: 0.43, shadowSegments: 20, shadowScale: 0.7, shadowLift: 0.04,
} as const;

export const NEST_GEOMETRY = {
  straw: [0.17, 0.29, 20], strawY: 0.045,
  egg: [0.17, 12, 10], eggScale: [0.85, 1.2, 0.85], eggY: 0.24,
} as const;

export const DECORATION_GEOMETRY = {
  binBody: [0.72, 0.58, 0.6], binBodyY: 0.33, lidHinge: [0, 0.64, -0.3],
  lid: [0.8, 0.1, 0.66], lidZ: 0.3,
  signPost: [0.12, 1.05, 0.12], signPostY: 0.525,
  signBoard: [0.9, 0.48, 0.1], signBoardY: 1.05,
  lettering: [[1.13, 0.5], [0.98, 0.32]], letteringHeight: 0.035, letteringDepth: 0.015, letteringZ: 0.059,
} as const;
