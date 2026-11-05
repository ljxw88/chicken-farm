import './style.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createDayNightCycle, type DayNightPhaseName } from './lighting';
import { createComposer, isPixelRenderingEnabled, type PixelRenderingState } from './postprocess';
import { createFarmLayout } from './scene/createFarmLayout';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';

declare global {
  interface Window {
    setDayNightCycleSeconds: (seconds: number) => void;
    setDayNightPhase: (phase: DayNightPhaseName) => void;
    setPixelRendering: (enabled: boolean) => void;
    setPixelSize: (cssPixels: number) => void;
    getPixelRendering: () => PixelRenderingState;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');

if (!canvas) {
  throw new Error('Scene canvas not found');
}

const { scene, camera, renderer, ground, follow, resize } = createScene(canvas);
const character = createCharacter();
character.position.y = GROUND_HEIGHT;
scene.add(character);
follow(character.position);
const { windows, obstacles } = createFarmLayout(scene);
const dayNight = createDayNightCycle({ scene, character, windows });
export const setDayNightCycleSeconds = dayNight.setDayNightCycleSeconds;
export const setDayNightPhase = dayNight.setDayNightPhase;
window.setDayNightCycleSeconds = setDayNightCycleSeconds;
window.setDayNightPhase = setDayNightPhase;
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
  dayNight.update(deltaSeconds);
  follow(character.position);
  composer.render(deltaSeconds);
});
