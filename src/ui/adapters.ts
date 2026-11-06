import type { DayNightCycleState, DayNightPhaseName } from '../lighting';

// These interfaces keep the DOM independent of Three.js and of future weather code.
export interface DayNightHudAdapter {
  phases: readonly DayNightPhaseName[];
  getState(): Pick<DayNightCycleState, 'phase' | 'following' | 'cycleSeconds'>;
  setPhase(phase: DayNightPhaseName): void;
  setFollowing(following: boolean): void;
}

export interface WeatherHudState {
  label: string;
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
