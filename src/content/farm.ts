// Coordinates are world-space X/Z. Render factories resolve asset IDs; these
// records and their dimensions contain no Three.js objects.
export interface FarmLayout {
  path: { assetId: 'prop.path'; points: readonly (readonly [number, number])[] };
  treeAssetId: 'prop.tree';
  trees: readonly { x: number; z: number; scale: number }[];
  pond: { assetId: 'prop.pond'; x: number; z: number; width: number; depth: number; waterWidth: number; waterDepth: number };
  waterAssetId: 'prop.water-feature';
  grass: { assetId: 'prop.grass'; positions: readonly (readonly [number, number])[] };
}

export interface FarmDecorations {
  chicken: { assetId: 'prop.chicken'; x: number; z: number };
  nest: { assetId: 'prop.nest'; x: number; z: number };
  bin: { assetId: 'prop.bin'; x: number; z: number };
  sign: { assetId: 'prop.sign'; x: number; z: number };
}

export const FARM_CONTENT_ID = 'farm-v1';
export const FARM_LAYOUT = {
  path: {
    assetId: 'prop.path',
    points: [
      [-3.4, -1.3], [-2.5, -1.22], [-1.6, -1.1], [-0.75, -0.65], [0, 0],
      [0.85, -0.2], [1.6, -0.9], [2.5, -1.7], [3.4, -1.93], [4.3, -1.95],
      [5.15, -1.65], [6, -0.9], [7.6, 0.4], [8.7, 1.35],
    ],
  },
  treeAssetId: 'prop.tree',
  trees: [
    { x: -2.15, z: 1.55, scale: 0.95 },
    { x: 4.8, z: 1.6, scale: 1 },
    { x: -5.8, z: -0.1, scale: 1.05 },
    { x: 0.05, z: -5.6, scale: 0.95 },
  ],
  pond: { assetId: 'prop.pond', x: 4, z: -3.5, width: 3.5, depth: 2.2, waterWidth: 3.1, waterDepth: 1.9 },
  waterAssetId: 'prop.water-feature',
  grass: {
    assetId: 'prop.grass',
    positions: [
      [-6.2, 2.5], [-3.8, 2.65], [-2.6, 3.1], [-0.8, 2.8], [1, 3.4], [3.5, 1.5],
      [5.4, 1.3], [6.2, -1.4], [6, -5.7], [2.9, -6.3], [1.3, -6.8], [-2.2, -5.7],
      [-6.5, -4.7], [-7.2, -1.6], [-6.8, 0.9], [-2.9, 0.35], [3, 0.85], [1.9, -4.8],
      [-0.75, -3.8], [4.8, 3.7], [-4.9, 4.4], [7.5, -3.4], [-7.5, 3.8], [0.4, 5],
    ],
  },
} as const satisfies FarmLayout;

export const FARM_DECORATIONS = {
  chicken: { assetId: 'prop.chicken', x: 1.75, z: 1.75 },
  nest: { assetId: 'prop.nest', x: 4.3, z: 0.7 },
  bin: { assetId: 'prop.bin', x: -2.8, z: -1.2 },
  sign: { assetId: 'prop.sign', x: 0.95, z: -2.35 },
} as const satisfies FarmDecorations;
