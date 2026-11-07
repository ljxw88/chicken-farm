// Query keys and independent seeded streams; no startup loader or persistence.
export const STARTUP_OPTIONS = {
  phaseKey: 'phase', weatherKey: 'weather', seasonKey: 'season', seedKey: 'seed', maxVisualSeed: 0xffffffff,
  gridKey: 'grid', gridEnabledValue: '1', pixelKey: 'pixel', pixelDisabledValue: '0',
  skyHudKey: 'skyhud', skyHudDisabledValue: '0',
} as const;

export const VISUAL_SEEDS = {
  sheep: 0xeb700001, smoke: 0x534d4f4b, fireflies: 0x464c4945, snow: 0x534e4f57,
} as const;
