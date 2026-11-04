import './style.css';
import { createScene } from './scene/createScene';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');

if (!canvas) {
  throw new Error('Scene canvas not found');
}

const { scene, camera, renderer, resize } = createScene(canvas);

resize();
window.addEventListener('resize', resize);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
