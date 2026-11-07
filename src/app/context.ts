import type { AudioController } from '../audio';
import type { createCharacter, createCharacterController } from '../character';
import type { Entity } from '../core/ecs';
import type { createEngine } from '../core/loop';
import type { DayNightComponents, WeatherComponents } from '../environment';
import type { createChimneySmoke } from '../effects/createChimneySmoke';
import type { createFireflies } from '../effects/createFireflies';
import type { createDayNightCycle, DayNightPhaseName } from '../lighting';
import type { createPlacementAdapter, PlacementComponents } from '../placement';
import type { createComposer, PixelRenderingState } from '../postprocess';
import type { createFarmDecorations } from '../render/farmDecorations';
import type { createFarmLayout } from '../scene/createFarmLayout';
import type { createFarmShadows } from '../scene/createFarmShadows';
import type { createScene } from '../scene/createScene';
import type { createGardenDressing } from '../scene/gardenDressing/createGardenDressing';
import type { createSheepfold } from '../scene/sheepfold/createSheepfold';
import type { createStartupPhaseController } from '../startupOptions';
import type { createFarmHud, createSkyHud, createSkyStateAdapter } from '../ui';
import type { createWeatherSystem, WeatherMode } from '../weather';
import type { GroundGrid } from '../world/ground';
import type { createFarmTerrain } from './farmTerrain';

export interface GameComponents extends PlacementComponents, DayNightComponents, WeatherComponents {}

type SceneParts = ReturnType<typeof createScene>;
type FarmParts = ReturnType<typeof createFarmLayout>;
type Engine = ReturnType<typeof createEngine<GameComponents>>;
type PhaseController = ReturnType<typeof createStartupPhaseController>;
type Weather = ReturnType<typeof createWeatherSystem>;

// Filled in registration order before the engine is started. The same typed
// context is passed to every feature; Three.js objects stay out of ECS data.
export interface AppContext extends SceneParts, FarmParts {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  skyRoot: HTMLElement;
  character: ReturnType<typeof createCharacter>;
  groundGrid: GroundGrid;
  farmTerrain?: ReturnType<typeof createFarmTerrain>;
  sheepfold: ReturnType<typeof createSheepfold>;
  garden: ReturnType<typeof createGardenDressing>;
  decorations: ReturnType<typeof createFarmDecorations>;
  farmShadows: ReturnType<typeof createFarmShadows>;
  engine: Engine;
  environment: Entity<GameComponents>;
  dayNight: ReturnType<typeof createDayNightCycle>;
  weather: Weather;
  visualSeed: number | undefined;
  smoke: ReturnType<typeof createChimneySmoke>;
  fireflies: ReturnType<typeof createFireflies>;
  phaseController: PhaseController;
  setDayNightCycleSeconds: PhaseController['setDayNightCycleSeconds'];
  setDayNightPhase: PhaseController['setDayNightPhase'];
  setDayNightFollowing: PhaseController['setFollowing'];
  getDayNightState: PhaseController['getState'];
  setWeather: Weather['setWeather'];
  getWeather: Weather['getWeather'];
  controls: ReturnType<typeof createCharacterController>;
  placement: ReturnType<typeof createPlacementAdapter>;
  audio: AudioController;
  farmHud: ReturnType<typeof createFarmHud>;
  skyState: ReturnType<typeof createSkyStateAdapter> | undefined;
  skyHud: ReturnType<typeof createSkyHud> | undefined;
  composer: ReturnType<typeof createComposer>;
  lastDevicePixelRatio: number;
  handleResize: () => void;
}

export type AppModule = (context: AppContext) => void;

declare global {
  interface Window {
    setDayNightCycleSeconds: (seconds: number) => void;
    setDayNightPhase: (phase: DayNightPhaseName) => void;
    setDayNightFollowing: (following: boolean) => void;
    getDayNightState: () => { phase: DayNightPhaseName; following: boolean; cycleSeconds: number };
    setPixelRendering: (enabled: boolean) => void;
    setPixelSize: (cssPixels: number) => void;
    getPixelRendering: () => PixelRenderingState;
    setWeather: (mode: WeatherMode) => void;
    getWeather: () => { mode: WeatherMode; rainAmount: number; cloudyAmount: number };
  }
}
