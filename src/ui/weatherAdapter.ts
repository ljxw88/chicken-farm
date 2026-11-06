import type { WeatherHudAdapter } from './adapters';

// EBR-35 is not on this base. Replace this boundary with an adapter to its
// actual capabilities after integration; do not manufacture weather state.
export function createPendingWeatherAdapter(): WeatherHudAdapter {
  return { status: 'pending', reason: 'Weather controls are waiting for EBR-35.' };
}
