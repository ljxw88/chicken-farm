import * as THREE from 'three';
import { createIsometricCamera } from './createIsometricCamera';
import { FARM_PALETTE } from './farmPalette';

export const GROUND_SIZE = 32;
export const GROUND_HEIGHT = 0;

export function createScene(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();

  const { camera, follow, resize: resizeCamera } = createIsometricCamera();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: FARM_PALETTE.grass, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_HEIGHT;
  scene.add(ground);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    resizeCamera(width, height);
  }

  return { scene, camera, renderer, ground, follow, resize };
}
