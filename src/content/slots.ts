// Art slots contain appearance only. World dimensions, positions and collision
// footprints live in the other content files, never in these slots.
export const FARM_PALETTE = {
  grass: 0x5fa846,
  dirt: 0xa67c52,
  dirtEdge: 0x7a5a3a,
  dirtHighlight: 0xc4a06a,
  barnWood: 0xd4a574,
  barnTrim: 0x8b6914,
  barnRoof: 0xc45a3a,
  barnDoor: 0x6b4423,
  barnWindow: 0x8aa0a8,
  treeTrunk: 0x6b4a2e,
  treeFoliageDark: 0x3d7a3a,
  treeFoliage: 0x5fa846,
  treeFoliageLight: 0x7cbc5a,
  wool: 0xf3ead6,
  pondWater: 0x5b8fa8,
  pondRim: 0x7aadb8,
  pondDepth: 0x3a6a7a,
} as const;

export interface BuildingSlots {
  cottage: { plaster: number; timber: number; door: number; roof: number; shingle: number; stone: number; glass: number };
  coop: { wall: number; timber: number; roof: number; posts: number; ramp: number; cleats: number; popHole: number };
}

export interface SheepSlots {
  woolTop: number; woolBase: number; woolShade: number; brown: number; detail: number; secondFaceGain: number;
}

export interface SheepfoldSlots {
  wall: number; roof: number; posts: number;
}

export interface PlacementTintSlots {
  valid: number;
  invalid: number;
  washOpacity: number;
  ghostOpacity: number;
  grid: number;
  gridOpacity: number;
}

export interface StairSlots {
  stoneMix: number;
  treadMixes: readonly number[];
  padMix: number;
  edgeMix: number;
  edgeBrightness: number;
}

export const ART_SLOTS = {
  palette: {
    farm: FARM_PALETTE,
    void: 0x101416,
    soil: [0x573c31, 0x61422e, 0x4a3228, 0x5f3c2b],
    rock: [0x33454a, 0x334d53, 0x2f3745, 0x334548],
    terrain: { colorBoost: 2, colorMix: 0.35 },
    vertexWhite: 0xffffff,
    contactShadow: 0x0a1409,
    character: { body: 0xffd477, eye: 0x302820, beak: 0xe99049 },
    lantern: { wing: 0xffd477, metal: 0x554433 },
    chicken: { feathers: 0xfff1d7, wing: 0xe4d1ae, comb: 0xc75b46, beak: 0xe9a048, eye: 0x332820 },
    sheep: { woolTop: 0xfff1d7, woolBase: FARM_PALETTE.wool, woolShade: 0xe4d1ae,
      brown: FARM_PALETTE.treeTrunk, detail: FARM_PALETTE.dirtEdge, secondFaceGain: 0.86 } satisfies SheepSlots,
    firefly: { core: 0xf2e27a },
    smoke: { color: 0xefe3c8, emissive: 0x000000 },
    nest: { straw: 0xb8925b, egg: 0xfff5db },
    decoration: { wood: 0x96714a, darkWood: 0x684a32, lettering: 0xf3dfb2 },
    water: {
      water: 0x5b8fa8, rim: 0x7aadb8, deep: 0x3a6a7a, foam: 0xbfe0e6,
      fallBottom: 0x8fc1cf, streak: 0xddeff2, plank: 0xc8956c, gap: 0x7a5a3a, rail: 0x8b5e3c,
    },
  },
  building: {
    cottage: {
      plaster: 0xefe3c8, timber: 0x8b5e3c, door: FARM_PALETTE.barnDoor, roof: FARM_PALETTE.barnRoof,
      shingle: 0xa94a30, stone: 0x9a8a78, glass: FARM_PALETTE.barnWindow,
    },
    coop: {
      wall: 0xc8956c, timber: 0x8b5e3c, roof: 0xa94a30, posts: FARM_PALETTE.barnDoor,
      ramp: FARM_PALETTE.dirt, cleats: FARM_PALETTE.dirtEdge, popHole: 0x3e2a1a,
    },
    sheepfold: { wall: 0xc8956c, roof: 0xa94a30, posts: FARM_PALETTE.barnDoor } satisfies SheepfoldSlots,
  } satisfies BuildingSlots & { sheepfold: SheepfoldSlots },
  light: {
    morning: {
      sky: 0xe8d4c8, fog: 0xe8d4c8, fogDensity: 0.012, ambient: 0xf0e0d0, ambientIntensity: 0.2,
      hemisphereSky: 0xe8d4c8, hemisphereGround: 0xa8c090, hemisphereIntensity: 0.25,
      directional: 0xffe8c8, directionalIntensity: 2.35, shadowOpacity: 0.22, nightLights: 0,
    },
    daytime: {
      sky: 0xa8d4f0, fog: 0xc8e0f0, fogDensity: 0.006, ambient: 0xe8f0e8, ambientIntensity: 0.07,
      hemisphereSky: 0xa8d4f0, hemisphereGround: 0x9cb88a, hemisphereIntensity: 0.35,
      directional: 0xfff2d6, directionalIntensity: 1.8, shadowOpacity: 0.22, nightLights: 0,
    },
    sunset: {
      sky: 0xf0a878, fog: 0xe89870, fogDensity: 0.015, ambient: 0xeadbc8, ambientIntensity: 0.08,
      hemisphereSky: 0xe8dec6, hemisphereGround: 0xb5b99a, hemisphereIntensity: 0.2,
      directional: 0xffeddb, directionalIntensity: 1.2, shadowOpacity: 0.22, nightLights: 0,
    },
    night: {
      sky: 0x2a2848, fog: 0x1e2430, fogDensity: 0.02, ambient: 0xaeb8c9, ambientIntensity: 0.26,
      hemisphereSky: 0x2a2848, hemisphereGround: 0x1e2430, hemisphereIntensity: 0.11,
      directional: 0xc8d4f0, directionalIntensity: 0.52, shadowOpacity: 0.09, nightLights: 1,
    },
    window: { color: 0xffcc88, intensity: 0.85 },
    lantern: { color: 0xffb060, intensity: 0.12, glassIntensity: 0.55 },
    contact: { characterOpacity: 0.22, treeOpacity: 0.16, chickenOpacity: 0.18, buildingOpacity: 0.12,
      sheepfoldFenceOpacity: 0.12, sheepfoldSheepOpacity: 0.18 },
    weather: { nightRainFill: 0.2, nightCloudFill: 0.18, cloudShadowOffset: 0.5, rainShadowOffset: 0.51,
      cloudShadowOpacity: 0.5, rainShadowOpacity: 0.8 },
  },
  post: { pixel: { enabled: true, imageRendering: 'pixelated' } },
  tint: {
    placement: { valid: 0x283724, invalid: 0xc45a3a, washOpacity: 0.5, ghostOpacity: 0.5,
      grid: 0xa67c52, gridOpacity: 0.7 } satisfies PlacementTintSlots,
  },
  prop: {
    stair: { stoneMix: 0.18, treadMixes: [0.76, 0.82, 0.78, 0.84, 0.8], padMix: 0.78,
      edgeMix: 0.5, edgeBrightness: 1.1 } satisfies StairSlots,
    character: { crownStrength: 0.15, dayCrownStrength: 0.28, dayBaseGain: 1.08 },
    firefly: { pulseFloor: 0.25, pulseRange: 0.75, rainDimming: 0.4 },
    smoke: { initialOpacity: 0, peakOpacity: 0.75, weatherNightDimming: 0.4, roughness: 1 },
  },
} as const;
