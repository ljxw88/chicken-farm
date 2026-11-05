import './style.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createDayNightCycle, type DayNightPhaseName } from './lighting';
import { createComposer } from './postprocess';
import { createFarmLayout } from './scene/createFarmLayout';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';

declare global {
  interface Window {
    setDayNightCycleSeconds: (seconds: number) => void;
    setDayNightPhase: (phase: DayNightPhaseName) => void;
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
  follow(character.position);
  composer.render();
});
