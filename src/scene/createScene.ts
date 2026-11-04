import * as THREE from 'three';

export function createScene(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8d8ef);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(11, 14, 18);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 32),
    new THREE.MeshStandardMaterial({ color: 0x5fa846, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // A subtle grid makes the angle and scale of the flat ground easier to see.
  const grid = new THREE.GridHelper(32, 32, 0x3a7129, 0x3a7129);
  grid.position.y = 0.01;
  const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
  for (const material of gridMaterials) {
    material.transparent = true;
    material.opacity = 0.2;
  }
  scene.add(grid);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
  scene.add(ambientLight);

  const sunlight = new THREE.DirectionalLight(0xfff4dd, 2);
  sunlight.position.set(6, 10, 8);
  scene.add(sunlight);

  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
  }

  return { scene, camera, renderer, resize };
}
