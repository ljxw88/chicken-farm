export const PLACEMENT_GEOMETRY = {
  fence: {
    post: [0.17, 0.95, 0.17], postXs: [-0.65, 0.65], postY: 0.475,
    rail: [1.4, 0.13, 0.1], railYs: [0.32, 0.67], railZ: 0.08,
  },
  plot: {
    baseInset: 0.06, baseHeight: 0.1, baseY: 0.05,
    surfaceInset: 0.2, surfaceHeight: 0.04, surfaceY: 0.11,
    furrowInset: 0.32, furrowHeight: 0.025, furrowDepth: 0.13, furrowZs: [-0.4, 0, 0.4], furrowY: 0.142,
  },
  overlay: { debugGridLift: 0.035, washPlane: [1, 1], ghostLift: 0.08, removeWashLift: 0.17, previewWashLift: 0.06 },
} as const;
