import './style.css';
import './ui/farmHud.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createEngine } from './core/loop';
import { createDayNightCycle, type DayNightPhaseName } from './lighting';
import { createPlacement } from './placement';
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

const { scene, camera, renderer, ground, stairs, follow, resize } = createScene(canvas);
const character = createCharacter();
character.position.y = GROUND_HEIGHT;
scene.add(character);
follow(character.position);
const { windows, extraEmissives, obstacles, splashExclusions } = createFarmLayout(scene);
const dayNight = createDayNightCycle({ scene, character, windows, extraEmissives });
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
const decorations = createFarmDecorations(scene, GROUND_HEIGHT);
let cancelClickTarget = () => {};
const placement = createPlacement({
  scene, camera, canvas, ground, groundSize: GROUND_SIZE, groundHeight: GROUND_HEIGHT,
  character, characterRadius: CHARACTER_RADIUS, obstacles,
  getBlockers: () => decorations,
  debugGrid: new URLSearchParams(window.location.search).get('grid') === '1',
  onActiveChange(active) {
    if (active) cancelClickTarget();
  },
});
const controls = createCharacterControls({
  character,
  camera,
  canvas,
  ground,
  groundSize: GROUND_SIZE,
  groundHeight: GROUND_HEIGHT,
  characterRadius: CHARACTER_RADIUS,
  obstacles,
  stairs,
  groundShadow: character.getObjectByName('character-shadow'),
  onPointerDown: placement.handlePointerDown,
});
cancelClickTarget = controls.cancelTarget;
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

createEngine({
  setAnimationLoop: (callback) => renderer.setAnimationLoop(callback),
  input: { target: window, canvas, getPlacement: () => ({ active: placement.isActive(), removing: placement.isRemoving() }) },
  beforeFrame() {
    // Moving a window between displays can change DPR without a resize event.
    if (window.devicePixelRatio !== lastDevicePixelRatio) handleResize();
  },
  update(deltaSeconds) {
    // Avoid a walking jump after a background tab resumes; lighting keeps elapsed time.
    controls.update(Math.min(deltaSeconds, 0.1));
    phaseController.update(deltaSeconds);
    farmHud.setPhase(dayNight.getPhase());
    follow(character.position);
    placement.update();
    weather.update(deltaSeconds);
  },
  render: (deltaSeconds) => composer.render(deltaSeconds),
}).start();
