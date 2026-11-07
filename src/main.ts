import './style.css';
import './ui/farmHud.css';
import { registerCharacter } from './app/character';
import type { AppContext, AppModule } from './app/context';
import { registerEffects } from './app/effects';
import { registerEngine } from './app/engine';
import { registerEnvironment } from './app/environment';
import { registerFarm, registerFarmDecorations } from './app/farm';
import { registerGarden } from './app/garden';
import { registerHud } from './app/hud';
import { registerPlacement } from './app/placement';
import { registerPresentation } from './app/presentation';
import { registerScene } from './app/scene';
import { registerStartup } from './app/startup';
import { registerGameInspection } from './debug/gameInspection';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hudRoot = document.querySelector<HTMLElement>('#farm-hud');
const skyRoot = document.querySelector<HTMLElement>('#hud');
if (!canvas) throw new Error('Scene canvas not found');
if (!hudRoot) throw new Error('Farm HUD root not found');
if (!skyRoot) throw new Error('Sky HUD root not found');

// The ordered modules fill the shared context before any frame or input event.
const context = { canvas, hudRoot, skyRoot } as AppContext;
const modules: readonly AppModule[] = [
  registerScene, registerFarm, registerGarden, registerFarmDecorations, registerEngine, registerEnvironment, registerEffects,
  registerStartup, registerCharacter, registerPlacement, registerHud, registerPresentation, registerGameInspection,
];
for (const register of modules) register(context);

export const setDayNightCycleSeconds = context.setDayNightCycleSeconds;
export const setDayNightPhase = context.setDayNightPhase;
export const setDayNightFollowing = context.setDayNightFollowing;
export const getDayNightState = context.getDayNightState;
export const setWeather = context.setWeather;
export const getWeather = context.getWeather;
context.engine.start();
