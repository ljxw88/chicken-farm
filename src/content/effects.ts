// Effect positions and dimensions are plain data; the renderer owns the meshes.
export const FIREFLIES = {
  assetId: 'effect.fireflies',
  homes: [
    [-2.8, 2.7, 1.2], [1.3, 3.4, 1.2], [4.9, 3.1, 1.2], [6.2, -3.6, 0.7],
    [-5.0, 1.4, 0.9], [4.1, 5.0, 1.2], [-0.8, 2.8, 1.2], [-4.3, 1.1, 1.2],
    [1.4, 5.4, 1.2], [5.1, 0.6, 1.2], [-3.8, 3.9, 1.2], [-5.0, 3.0, 0.9],
    [5.8, -1.5, 0.9], [0.2, 2.7, 1.2],
  ],
  radiusMin: 0.5, radiusMax: 1.19, jitter: [-0.08, 0.08], height: [0.75, 1.35],
  heightAmplitude: [0.08, 0.12], angularSpeed: [0.16, 0.29], pulsePeriod: [2.5, 4.5],
  size: [0.22, 0.22], rainUnaffectedCount: 6, cloudUnaffectedCount: 10,
} as const;

export const CHIMNEY_SMOKE = {
  assetId: 'effect.chimney-smoke', capacity: 6, spawnInterval: 0.55,
  wind: [0.94, 0, -0.34], windSpeed: 0.25, swayAmplitude: 0.06, swaySpeed: Math.PI / 2,
  puffGeometry: [1, 0], sizeFactorMin: 0.85, sizeFactorRange: 0.3,
  lifetime: [3.6, 2.6], riseSpeed: 0.45, size: [0.28, 0.65], sizeExponent: 1.5,
  fadeStart: 0.4,
} as const;
