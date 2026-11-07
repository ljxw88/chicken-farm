// World positions, render IDs and collision footprints stay separate from art slots.
export const GARDEN_DRESSING = {
  hiveAssetId: 'prop.beehives', flowerAssetId: 'prop.flower-patches',
  beehives: [{ x: -6.7, z: -3.5 }, { x: -6.7, z: -4.3 }],
  flowers: [
    { x: -1.2, z: 4.1, colorSlot: 'flowerRed' },
    { x: 1.4, z: 4.6, colorSlot: 'flowerYellow' },
    { x: -7, z: 0.9, colorSlot: 'flowerBlue' },
    { x: 6, z: 4.5, colorSlot: 'flowerOrange' },
  ],
} as const;

export const BEEHIVE_FOOTPRINT = { halfWidth: 0.35, halfDepth: 0.35 } as const;

export const BEEHIVE_GEOMETRY = {
  body: [0.7, 0.45, 0.7], stand: [0.68, 0.1, 0.68], entrance: [0.3, 0.1, 0.1],
  shadow: [1, 16], shadowScale: [0.52, 0.4, 1], shadowY: 0.012, shadowOffset: 0.5,
  standY: 0.05, bodyY: 0.315, entrancePosition: [0, 0.27, 0.38],
  roof: { width: 0.7, depth: 0.7, wallTop: 0.55, rise: 0.25, overhang: 0.08 },
  gableWidth: 0.68, gableX: -0.34, roofNudge: 0.01,
} as const;

export const FLOWER_GEOMETRY = {
  stem: [0.11, 0.2, 0.11], head: [0.1, 0.1, 0.14, 6], shadow: [1, 16],
  shadowScale: [0.38, 0.3, 1], shadowY: 0.01, shadowOffset: 0.2, stemY: 0.1, headY: 0.25,
  // Each colourway has its own hand-arranged silhouette, not a recoloured copy.
  blooms: [
    [[-0.26, -0.22], [-0.04, -0.28], [0.22, -0.23], [-0.25, 0.09], [0.02, 0.04], [0.26, 0.13], [-0.08, 0.27]],
    [[-0.25, -0.24], [0.03, -0.28], [0.27, -0.1], [-0.2, 0.09], [0.07, 0.05], [0.18, 0.27]],
    [[-0.27, -0.18], [-0.02, -0.27], [0.22, -0.25], [-0.22, 0.02], [0.05, -0.02], [0.27, 0.09], [-0.17, 0.24], [0.1, 0.26]],
    [[-0.28, -0.1], [-0.12, -0.25], [0.15, -0.24], [0.28, -0.03], [-0.23, 0.17], [0.04, 0.04], [0.19, 0.24]],
  ],
} as const;
