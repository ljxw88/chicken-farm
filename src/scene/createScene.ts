import * as THREE from 'three';
import { createIsland, VOID_COLOR } from './createIsland';
import { createIsometricCamera } from './createIsometricCamera';
import { ISLAND } from '../content/world';

export { GROUND_HEIGHT, GROUND_SIZE } from './createIsland';

export function createScene(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(VOID_COLOR);

  const { camera, follow, resize: resizeCamera } = createIsometricCamera();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(VOID_COLOR, ISLAND.clearAlpha);

  const { ground, stairs } = createIsland(scene);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    resizeCamera(width, height);
  }

  return { scene, camera, renderer, ground, stairs, follow, resize };
}
