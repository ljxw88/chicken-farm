export const PLACEMENT_GEOMETRY = {
  fence: {
    post: [0.17, 0.95, 0.17], postXs: [-0.65, 0.65], postY: 0.475,
    rail: [1.4, 0.13, 0.1], railYs: [0.32, 0.67], railZ: 0.08,
  },
  plot: {
    tileInset: 0.06, edgeWidth: 0.14, bedInset: 0.02, bedHeight: 0.1, bedY: 0.05,
    frameHeight: 0.14, frameY: 0.13, seedling: [0.2, 0.22, 0.2],
    seedlingRows: [-0.34, 0.34], seedlingColumns: [-0.93, -0.31, 0.31, 0.93], seedlingY: 0.2,
  },
  overlay: { debugGridLift: 0.035, washPlane: [1, 1], ghostLift: 0.08, removeWashLift: 0.17, previewWashLift: 0.06 },
} as const;
