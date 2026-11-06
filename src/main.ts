import './style.css';
import './ui/farmHud.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createInteractionController } from './interactions';
import { createQaFlockStubs } from './interactions/qa/createQaFlockStubs';
import { createQaWorldStubs } from './interactions/qa/createQaWorldStubs';
import { createInventory } from './inventory/createInventory';
import { createSupplies } from './inventory/createSupplies';
import { createDayNightCycle, type DayNightPhaseName } from './lighting';
import { createComposer, isPixelRenderingEnabled, type PixelRenderingState } from './postprocess';
import { createFarmLayout } from './scene/createFarmLayout';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';
import { createStartupPhaseController, parseStartupOptions } from './startupOptions';
import { createFarmHud, createInteractionPrompt } from './ui';
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
const interactionView = createInteractionPrompt();
let cancelClickTarget = () => {};
const interactions = createInteractionController({
  character, camera, canvas, view: interactionView, onInteract: () => cancelClickTarget(),
});
const supplies = createSupplies();
const inventory = createInventory();
const qaFlock = createQaFlockStubs(scene, GROUND_HEIGHT, { inventory, onEggCollected: supplies.addEgg });
const qaWorld = createQaWorldStubs(scene, GROUND_HEIGHT);
for (const interactable of [...qaFlock.interactables, ...qaWorld.interactables]) {
  interactions.register(interactable);
}
const controls = createCharacterControls({
  character,
  camera,
  canvas,
  ground,
  groundSize: GROUND_SIZE,
  groundHeight: GROUND_HEIGHT,
  characterRadius: CHARACTER_RADIUS,
  obstacles,
  onPointerDown: interactions.handlePointerDown,
});
cancelClickTarget = controls.cancelTarget;
const farmHud = createFarmHud({
  root: hudRoot,
  supplies,
  inventory,
  initialPhase: dayNight.getPhase(),
  isEggReady: qaFlock.isEggReady,
  collectEgg: qaFlock.collectEgg,
  onCollected(message) {
    controls.cancelTarget();
    interactionView.showMessage(message);
    interactions.update();
  },
});
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
  interactions.update();
  weather.update(deltaSeconds);
  composer.render(deltaSeconds);
});
