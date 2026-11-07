// The HUD only knows the scene's public controls, not its engine or drivers.
export type SkyPhase = 'morning' | 'daytime' | 'sunset' | 'night';
export type SkyWeather = 'clear' | 'rain' | 'cloudy' | 'snow';

export interface DayNightHudState {
  phase: SkyPhase;
  following: boolean;
  cycleSeconds: number;
}

export interface SkySceneApi {
  getDayNightState(): DayNightHudState;
  setDayNightPhase(phase: SkyPhase): void;
  setDayNightFollowing(following: boolean): void;
  getWeather?(): { mode: SkyWeather };
  setWeather?(mode: SkyWeather): void;
}

// These interfaces keep the DOM independent of Three.js and of future weather code.
export interface DayNightHudAdapter {
  phases: readonly SkyPhase[];
  getState(): DayNightHudState;
  setPhase(phase: SkyPhase): void;
  setFollowing(following: boolean): void;
}

export interface WeatherHudState {
  label: string;
  mode?: SkyWeather;
  // Omitted when the weather system does not support automatic changes.
  automatic?: boolean;
}

export type WeatherHudAdapter =
  | { status: 'pending'; reason: string }
  | {
    status: 'ready';
    getState(): WeatherHudState;
    previous?(): void;
    next?(): void;
    setAutomatic?(automatic: boolean): void;
  };
