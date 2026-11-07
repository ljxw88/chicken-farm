import type { SkyPhase, SkyWeather } from './adapters';

function lineIcon(content: string) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${content}</svg>`;
}

export const CLOSE_ICON = lineIcon('<path d="M6 6l12 12M18 6L6 18"/>');
export const PREVIOUS_ICON = lineIcon('<path d="m14 6-6 6 6 6"/>');
export const NEXT_ICON = lineIcon('<path d="m10 6 6 6-6 6"/>');
export const SPEAKER_ICON = lineIcon('<path d="M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>');
export const MUTED_SPEAKER_ICON = lineIcon('<path d="M4 9v6h4l5 4V5L8 9H4ZM4 4l16 16"/>');
export const EXPAND_ICON = lineIcon('<path d="M8.5 4.5h-4v4M15.5 4.5h4v4M4.5 15.5v4h4M19.5 15.5v4h-4"/>');
export const COLLAPSE_ICON = lineIcon('<path d="M4.5 8.5h4v-4M19.5 8.5h-4v-4M8.5 19.5v-4h-4M15.5 19.5v-4h4"/>');
export const SUN_ICON = lineIcon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/>');
export const SUNSET_ICON = lineIcon('<path d="M3 17h18M5 20h14M7 17a5 5 0 0 1 10 0M12 4v3M4.5 9.5l2 2M19.5 9.5l-2 2"/>');
export const MOON_ICON = lineIcon('<path d="M19.2 15.2A8 8 0 0 1 8.8 4.8a8 8 0 1 0 10.4 10.4Z"/><path d="M18.5 4v3M17 5.5h3"/>');
export const MORE_ICON = lineIcon('<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>');

function artwork(content: string) {
  return `<svg viewBox="0 0 120 120" aria-hidden="true">${content}</svg>`;
}

function dots(content: string) {
  return `<g fill="none" stroke="#fffdf2" stroke-opacity=".85" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray=".1 6">${content}</g>`;
}

function sunDisc(x: number, y: number, color = '#fffdf2') {
  return artwork(`<circle cx="${x}" cy="${y}" r="22" fill="${color}"/>${dots(`<circle cx="${x}" cy="${y}" r="33"/><path d="M12 101h96"/>`)}`);
}

export const PHASE_ARTWORK: Record<SkyPhase, string> = {
  morning: sunDisc(37, 74),
  daytime: sunDisc(60, 43),
  sunset: sunDisc(83, 74, '#ffe2b8'),
  night: artwork(`<path d="M78 31a29 29 0 1 0 11 51A29 29 0 0 1 78 31Z" fill="#dfe8ff"/>${dots('<circle cx="60" cy="59" r="40"/><path d="M12 105h96"/>')}`),
};

const FRONT_CLOUD = 'M34 77a18 18 0 0 1 1-36 24 24 0 0 1 43 6 16 16 0 0 1 4 30H34Z';

export const WEATHER_ARTWORK: Record<SkyWeather, string> = {
  clear: PHASE_ARTWORK.daytime,
  cloudy: artwork(`<defs><mask id="sky-cloud-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="120"><rect width="120" height="120" fill="white"/><path d="${FRONT_CLOUD}" fill="black"/></mask></defs><circle cx="48" cy="45" r="17" fill="#fffdf2" mask="url(#sky-cloud-cut)"/>${dots(`<circle cx="48" cy="45" r="27"/><path d="${FRONT_CLOUD}M57 33a22 22 0 0 1 39 16 13 13 0 0 1-2 25M12 101h96"/>`)}`),
  rain: artwork(`${dots('<path d="M31 65a17 17 0 0 1 1-34 24 24 0 0 1 45 5 15 15 0 0 1 3 29H31ZM36 75l-6 14M57 75l-6 14M78 75l-6 14M12 104h96"/>')}`),
  snow: artwork(`${dots('<path d="M31 65a17 17 0 0 1 1-34 24 24 0 0 1 45 5 15 15 0 0 1 3 29H31ZM32 75v16M25 79l14 8M25 87l14-8M57 75v16M50 79l14 8M50 87l14-8M82 75v16M75 79l14 8M75 87l14-8M12 104h96"/>')}`),
};

// A neutral waiting indicator, not a claimed weather condition.
export const PENDING_WEATHER_ARTWORK = artwork(dots('<circle cx="60" cy="60" r="34"/><path d="M47 60h1M60 60h1M73 60h1"/>'));
