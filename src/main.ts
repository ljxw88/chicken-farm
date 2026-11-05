import './style.css';
import { createComposer } from './postprocess';
import { createScene } from './scene/createScene';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');

if (!canvas) {
  throw new Error('Scene canvas not found');
}

const { scene, camera, renderer, resize } = createScene(canvas);
const composer = createComposer(renderer, scene, camera);

function handleResize() {
  resize();
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);
}

handleResize();
window.addEventListener('resize', handleResize);

renderer.setAnimationLoop(() => {
  composer.render();
});
