import { ART_SLOTS } from './slots';

// Sizes and offsets are separate from the colour/intensity slots.
export const DAY_NIGHT_PHASES = [
  { name: 'morning', ...ART_SLOTS.light.morning, shadowOffset: 0.48 },
  { name: 'daytime', ...ART_SLOTS.light.daytime, shadowOffset: 0.266 },
  { name: 'sunset', ...ART_SLOTS.light.sunset, shadowOffset: 0.48 },
  { name: 'night', ...ART_SLOTS.light.night, shadowOffset: 0.16 },
] as const;

export type DayNightPhaseName = (typeof DAY_NIGHT_PHASES)[number]['name'];
export const DEFAULT_DAY_NIGHT_CYCLE_SECONDS = 72;
export const WINDOW_LIGHT = { ...ART_SLOTS.light.window, distance: 7, decay: 2 } as const;
export const LANTERN_LIGHT = { ...ART_SLOTS.light.lantern, distance: 3.5, decay: 2 } as const;
