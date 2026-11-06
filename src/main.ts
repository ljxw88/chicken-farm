import './style.css';
import './ui/farmHud.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createDayNightCycle, type DayNightPhaseName } from './lighting';
import { createComposer, isPixelRenderingEnabled, type PixelRenderingState } from './postprocess';
import { createFarmDecorations } from './scene/createFarmDecorations';
import { createFarmLayout } from './scene/createFarmLayout';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';
import { createStartupPhaseController, parseStartupOptions } from './startupOptions';
import { createFarmHud } from './ui';
import { createWeatherSystem, type WeatherMode } from './weather';

declare global {
  interface Window {
    setDayNightCycleSeconds: (seconds: number) => void;
    setDayNightPhase: (phase: DayNightPhaseName) => void;
    setPixelRendering: (enabled: boolean) => void;
    setPixelSize: (cssPixels: number) => void;
    getPixelRendering: () => PixelRenderingState;
    setWeather: (mode: WeatherMode) => void;
    getWeather: () => { mode: WeatherMode; rainAmount: number; cloudyAmount: number };
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hudRoot = document.querySelector<HTMLElement>('#farm-hud');

if (!canvas) {
  throw new Error('Scene canvas not found');
}
if (!hudRoot) {
  throw new Error('Farm HUD root not found');
}

const { scene, camera, renderer, ground, follow, resize } = createScene(canvas);
const character = createCharacter();
character.position.y = GROUND_HEIGHT;
scene.add(character);
follow(character.position);
const { windows, obstacles, splashExclusions } = createFarmLayout(scene);
const dayNight = createDayNightCycle({ scene, character, windows });
const weather = createWeatherSystem({
  scene, camera, anchor: character, groundHeight: GROUND_HEIGHT, groundSize: GROUND_SIZE,
  splashExclusions, setDirectionalIntensityMultiplier: dayNight.setDirectionalIntensityMultiplier,
  setAmbientHemisphereColorMultiplier: dayNight.setAmbientHemisphereColorMultiplier,
});
const startup = parseStartupOptions(window.location.search);
const phaseController = createStartupPhaseController(dayNight, startup.phase);
if (startup.weather) weather.setWeather(startup.weather);
export const setDayNightCycleSeconds = phaseController.setDayNightCycleSeconds;
export const setDayNightPhase = phaseController.setDayNightPhase;
export const setWeather = weather.setWeather;
export const getWeather = weather.getWeather;
window.setDayNightCycleSeconds = setDayNightCycleSeconds;
window.setDayNightPhase = setDayNightPhase;
window.setWeather = setWeather;
window.getWeather = getWeather;
createFarmDecorations(scene, GROUND_HEIGHT);
const controls = createCharacterControls({
  character,
  camera,
  canvas,
  ground,
  groundSize: GROUND_SIZE,
  groundHeight: GROUND_HEIGHT,
  characterRadius: CHARACTER_RADIUS,
  obstacles,
});
const farmHud = createFarmHud({ root: hudRoot, initialPhase: dayNight.getPhase() });
const composer = createComposer(renderer, scene, camera);
window.setPixelRendering = composer.setEnabled;
window.setPixelSize = composer.setPixelSize;
window.getPixelRendering = composer.getState;

let lastDevicePixelRatio = window.devicePixelRatio;

function handleResize() {
  resize();
  composer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  lastDevicePixelRatio = window.devicePixelRatio;
}

handleResize();
// The default stays on; ?pixel=0 is a console-free native comparison.
if (!isPixelRenderingEnabled(window.location.search)) composer.setEnabled(false);
window.addEventListener('resize', handleResize);

let previousTime: number | undefined;
renderer.setAnimationLoop((time) => {
  // Moving a window between displays can change DPR without a resize event.
  if (window.devicePixelRatio !== lastDevicePixelRatio) handleResize();
  const deltaSeconds = previousTime === undefined ? 0 : Math.max((time - previousTime) / 1000, 0);
  previousTime = time;
  // Avoid a walking jump after a background tab resumes; lighting keeps elapsed time.
  controls.update(Math.min(deltaSeconds, 0.1));
  phaseController.update(deltaSeconds);
  farmHud.setPhase(dayNight.getPhase());
  follow(character.position);
  weather.update(deltaSeconds);
  composer.render(deltaSeconds);
});
