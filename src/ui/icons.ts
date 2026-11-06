import type { DayNightPhaseName } from '../lighting';

function lineIcon(content: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}

export const CLOSE_ICON = lineIcon('<path d="M6 6l12 12M18 6L6 18"/>');
export const PREVIOUS_ICON = lineIcon('<path d="m14 6-6 6 6 6"/>');
export const NEXT_ICON = lineIcon('<path d="m10 6 6 6-6 6"/>');
export const SPEAKER_ICON = lineIcon('<path d="M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>');
export const EXPAND_ICON = lineIcon('<path d="M8.5 4.5h-4v4M15.5 4.5h4v4M4.5 15.5v4h4M19.5 15.5v4h-4"/>');
export const COLLAPSE_ICON = lineIcon('<path d="M4.5 8.5h4v-4M19.5 8.5h-4v-4M8.5 19.5v-4h-4M15.5 19.5v-4h4"/>');
export const SUN_ICON = lineIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/>');
export const MOON_ICON = lineIcon('<path d="M19.2 15.2A8 8 0 0 1 8.8 4.8a8 8 0 1 0 10.4 10.4Z"/><path d="M18.5 4v3M17 5.5h3"/>');
export const MORE_ICON = lineIcon('<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>');

function dottedArtwork(content: string) {
  return `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.1 5.3" aria-hidden="true">${content}</svg>`;
}

export const PHASE_ARTWORK: Record<DayNightPhaseName, string> = {
  morning: dottedArtwork('<circle cx="50" cy="48" r="19"/><path d="M17 72h66M50 13v9M24 25l7 7M76 25l-7 7M14 48h9M77 48h9"/>'),
  daytime: dottedArtwork('<circle cx="50" cy="50" r="20"/><path d="M50 11v10M50 79v10M11 50h10M79 50h10M22 22l7 7M71 71l7 7M78 22l-7 7M29 71l-7 7"/>'),
  sunset: dottedArtwork('<circle cx="50" cy="54" r="19"/><path d="M15 74h70M50 20v8M26 30l6 6M74 30l-6 6M17 51h8M75 51h8"/>'),
  night: dottedArtwork('<path d="M63 23a29 29 0 1 0 15 50A29 29 0 0 1 63 23Z"/><path d="M72 22v9M67.5 26.5h9M80 43v7M76.5 46.5h7"/>'),
};

// A neutral waiting indicator, not a claimed weather condition.
export const PENDING_WEATHER_ARTWORK = dottedArtwork('<circle cx="50" cy="50" r="28"/><circle cx="40" cy="50" r="1.5" fill="currentColor" stroke="none"/><circle cx="50" cy="50" r="1.5" fill="currentColor" stroke="none"/><circle cx="60" cy="50" r="1.5" fill="currentColor" stroke="none"/>');
