import { createSnow } from '../weather/createSnow';

// Plain weather visual IDs resolve to rendering factories outside content data.
export const WEATHER_ASSETS = { 'effect.snow': createSnow } as const;
