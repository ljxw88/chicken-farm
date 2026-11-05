import * as THREE from 'three';
import { createIsometricCamera } from './createIsometricCamera';

export const GROUND_SIZE = 32;
export const GROUND_HEIGHT = 0;

export function createScene(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();

  const { camera, follow, resize: resizeCamera } = createIsometricCamera();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x5fa846, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_HEIGHT;
  scene.add(ground);

  // A subtle grid makes the angle and scale of the flat ground easier to see.
  const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE, 0x3a7129, 0x3a7129);
  grid.position.y = GROUND_HEIGHT + 0.01;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of gridMaterials) {
    material.transparent = true;
    material.opacity = 0.2;
  }
  scene.add(grid);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    resizeCamera(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
  }

  return { scene, camera, renderer, ground, follow, resize };
}
