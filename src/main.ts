import './style.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createDayNightCycle, DAY_NIGHT_PHASES, type DayNightPhaseName } from './lighting';
import { createComposer } from './postprocess';
import { createFarmLayout } from './scene/createFarmLayout';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';
import { createPendingWeatherAdapter, createSkyHud } from './ui';

declare global {
  interface Window {
    setDayNightCycleSeconds: (seconds: number) => void;
    setDayNightPhase: (phase: DayNightPhaseName) => void;
  }
}

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const hudRoot = document.querySelector<HTMLElement>('#hud');

if (!canvas) {
  throw new Error('Scene canvas not found');
}
if (!hudRoot) {
  throw new Error('HUD root not found');
}

const { scene, camera, renderer, ground, follow, resize } = createScene(canvas);
const character = createCharacter();
character.position.y = GROUND_HEIGHT;
scene.add(character);
follow(character.position);
const { windows, obstacles } = createFarmLayout(scene);
const dayNight = createDayNightCycle({ scene, character, windows });
// EBR-36's farm day is 24 minutes; the underlying cycle retains its own default.
dayNight.setDayNightCycleSeconds(24 * 60);
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
let previousLightingTime: number | undefined;
const hud = createSkyHud({
  root: hudRoot,
  dayNight: {
    phases: DAY_NIGHT_PHASES.map((phase) => phase.name),
    getState: dayNight.getState,
    setPhase: dayNight.setDayNightPhase,
    setFollowing: (following) => {
      const wasFollowing = dayNight.getState().following;
      dayNight.setFollowing(following);
      // If rendering was suspended while paused, don't count that time on resume.
      if (following && !wasFollowing) previousLightingTime = performance.now();
    },
  },
  weather: createPendingWeatherAdapter(),
});

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
  const lightingDeltaSeconds = previousLightingTime === undefined ? 0 : Math.max((time - previousLightingTime) / 1000, 0);
  previousTime = time;
  // A queued animation frame can carry an older timestamp than the resume event.
  previousLightingTime = previousLightingTime === undefined ? time : Math.max(previousLightingTime, time);
  // Avoid a walking jump after a background tab resumes; lighting keeps elapsed time.
  controls.update(Math.min(deltaSeconds, 0.1));
  dayNight.update(lightingDeltaSeconds);
  hud.update();
  follow(character.position);
  composer.render();
});
