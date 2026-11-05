import './style.css';
import './ui/farmHud.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createInteractionController } from './interactions';
import { createQaFlockStubs } from './interactions/qa/createQaFlockStubs';
import { createQaWorldStubs } from './interactions/qa/createQaWorldStubs';
import { createSupplies } from './inventory/createSupplies';
import { createDayNightCycle, type DayNightPhaseName } from './lighting';
import { createComposer } from './postprocess';
import { createFarmLayout } from './scene/createFarmLayout';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';
import { createFarmHud, createInteractionPrompt } from './ui';
import { createWeatherSystem, type WeatherMode } from './weather';

declare global {
  interface Window {
    setDayNightCycleSeconds: (seconds: number) => void;
    setDayNightPhase: (phase: DayNightPhaseName) => void;
    setWeather: (mode: WeatherMode) => void;
    getWeather: () => { mode: WeatherMode; rainAmount: number };
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
});
export const setDayNightCycleSeconds = dayNight.setDayNightCycleSeconds;
export const setDayNightPhase = dayNight.setDayNightPhase;
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
const qaFlock = createQaFlockStubs(scene, GROUND_HEIGHT, { onEggCollected: supplies.addEgg });
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

function handleResize() {
  resize();
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
}

handleResize();
window.addEventListener('resize', handleResize);

let previousTime: number | undefined;
renderer.setAnimationLoop((time) => {
  const deltaSeconds = previousTime === undefined ? 0 : Math.max((time - previousTime) / 1000, 0);
  previousTime = time;
  // Avoid a walking jump after a background tab resumes; lighting keeps elapsed time.
  controls.update(Math.min(deltaSeconds, 0.1));
  dayNight.update(deltaSeconds);
  farmHud.setPhase(dayNight.getPhase());
  follow(character.position);
  interactions.update();
  weather.update(deltaSeconds);
  composer.render();
});
