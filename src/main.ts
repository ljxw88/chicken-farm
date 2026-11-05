import './style.css';
import { CHARACTER_RADIUS, createCharacter, createCharacterControls } from './character';
import { createComposer } from './postprocess';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from './scene/createScene';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');

if (!canvas) {
  throw new Error('Scene canvas not found');
}

const { scene, camera, renderer, ground, follow, resize } = createScene(canvas);
const character = createCharacter();
character.position.y = GROUND_HEIGHT;
scene.add(character);
follow(character.position);
const controls = createCharacterControls({
  character,
  camera,
  canvas,
  ground,
  groundSize: GROUND_SIZE,
  groundHeight: GROUND_HEIGHT,
  characterRadius: CHARACTER_RADIUS,
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
  // Avoid a large jump after a background tab resumes.
  const deltaSeconds = previousTime === undefined ? 0 : Math.min((time - previousTime) / 1000, 0.1);
  previousTime = time;
  controls.update(deltaSeconds);
  follow(character.position);
  composer.render();
});
