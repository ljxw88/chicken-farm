// Building model dimensions are separate from building.cottage/coop art slots.
export const COTTAGE_GEOMETRY = {
  faceDepth: 0.1, faceInset: 0.05,
  baseHeight: 0.25, cornerPostSize: 0.16, cornerInset: 0.08, eaveBeamSize: 0.12, eaveInset: 0.06,
  chimneyTop: 3.6, chimneySize: 0.45, chimneyHalfSize: 0.225, chimneyClearance: 0.1,
  chimneyX: 1.5, chimneyZ: -0.7,
  doorFrame: [1.34, 1.72], doorFrameY: 0.86, door: [1.1, 1.6], doorY: 0.8,
  windowXs: [-1.2, 1.2], windowY: 1.2, windowFrame: [1.04, 1.04], window: [0.8, 0.8],
} as const;

export const COOP_GEOMETRY = {
  postSize: 0.3, postInset: 0.15, trimWidth: 0.14, trimDepth: 0.1, trimXInset: 0.07, trimZInset: 0.05,
  eaveHeight: 0.12, eaveYInset: 0.06,
  popHole: [0.4, 0.5, 0.1], popHoleY: 0.25, popHoleInset: 0.05,
  glow: [0.2, 0.25, 0.1], glowInset: 0.05,
  cleatSpacing: 0.25, cleatHeight: 0.1, cleatDepth: 0.1, cleatOffset: 0.05,
} as const;

export const GABLE_GEOMETRY = {
  gableInset: 0.04, roofThickness: 0.14, bandSpacing: 0.45, bandEndClearance: 0.1,
  bandHalfWidth: 0.06, bandTopOffset: 0.1, bandBottomOffset: 0.02,
} as const;
