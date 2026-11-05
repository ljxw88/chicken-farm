import * as THREE from 'three';
import { createIsland, VOID_COLOR } from './createIsland';
import { createIsometricCamera } from './createIsometricCamera';

export { GROUND_HEIGHT, GROUND_SIZE } from './createIsland';

export function createScene(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID_COLOR);

  const { camera, follow, resize: resizeCamera } = createIsometricCamera();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(VOID_COLOR, 1);

  const { ground } = createIsland(scene);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    resizeCamera(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
  }

  return { scene, camera, renderer, ground, follow, resize };
}
