// Query keys and independent seeded streams; no startup loader or persistence.
export const STARTUP_OPTIONS = {
  phaseKey: 'phase', weatherKey: 'weather', seedKey: 'seed', maxVisualSeed: 0xffffffff,
} as const;

export const VISUAL_SEEDS = {
  sheep: 0xeb700001, smoke: 0x534d4f4b, fireflies: 0x464c4945,
} as const;
