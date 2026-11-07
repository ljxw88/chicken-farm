import './style.css';
import './ui/farmHud.css';
import { registerCharacter } from './app/character';
import type { AppContext, AppModule } from './app/context';
import { registerEffects } from './app/effects';
import { registerEngine } from './app/engine';
import { registerEnvironment } from './app/environment';
import { registerFarm } from './app/farm';
import { registerHud } from './app/hud';
import { registerPlacement } from './app/placement';
import { registerPresentation } from './app/presentation';
import { registerScene } from './app/scene';
import { registerStartup } from './app/startup';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hudRoot = document.querySelector<HTMLElement>('#farm-hud');
if (!canvas) throw new Error('Scene canvas not found');
if (!hudRoot) throw new Error('Farm HUD root not found');

// The ordered modules fill the shared context before any frame or input event.
const context = { canvas, hudRoot } as AppContext;
const modules: readonly AppModule[] = [
  registerScene, registerFarm, registerEngine, registerEnvironment, registerEffects,
  registerStartup, registerCharacter, registerPlacement, registerHud, registerPresentation,
];
for (const register of modules) register(context);

export const setDayNightCycleSeconds = context.setDayNightCycleSeconds;
export const setDayNightPhase = context.setDayNightPhase;
export const setWeather = context.setWeather;
export const getWeather = context.getWeather;
context.engine.start();
