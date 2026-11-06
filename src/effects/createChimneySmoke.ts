import * as THREE from 'three';
import { createVisualRandom } from './createVisualRandom';

const CAPACITY = 5;
const SPAWN_INTERVAL = 0.6;
const WIND = new THREE.Vector3(0.94, 0, -0.34).normalize().multiplyScalar(0.25);

interface ChimneySmokeOptions {
  scene: THREE.Scene;
  random?: () => number;
}

/** Visual-only smoke; the named anchor belongs to the existing cottage. */
export function createChimneySmoke({ scene, random = createVisualRandom(0x534d4f4b) }: ChimneySmokeOptions) {
  const chimney = scene.getObjectByName('cottage-chimney-top');
  if (!chimney) throw new Error('Cottage chimney anchor not found');

  const root = new THREE.Group();
  root.name = 'chimney-smoke';
  scene.add(root);

  // Normalize the icosahedron's bounding box to one unit, so the scale below
  // is the actual world-space puff width, not the radius of its circumsphere.
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  geometry.computeBoundingBox();
  const dimensions = geometry.boundingBox!.getSize(new THREE.Vector3());
  geometry.scale(1 / dimensions.x, 1 / dimensions.y, 1 / dimensions.z);
  const puffs = Array.from({ length: CAPACITY }, (_, index) => {
    const material = new THREE.MeshStandardMaterial({
      color: 0xe4d1ae, roughness: 1, flatShading: true,
      transparent: true, opacity: 0, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `chimney-smoke-${index + 1}`;
    mesh.raycast = () => {};
    root.add(mesh);
    return { mesh, material, born: -index * SPAWN_INTERVAL, alive: true };
  });

  function orient(puff: (typeof puffs)[number]) {
    // Quarter turns retain the measured 0.22–0.50 bounding dimensions.
    puff.mesh.rotation.y = Math.floor(random() * 4) * Math.PI / 2;
  }
  puffs.forEach(orient);

  const origin = new THREE.Vector3();
  let elapsed = 0;
  let spawnIndex = 1;

  function update(deltaSeconds: number, rainAmount: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 ||
      !Number.isFinite(rainAmount) || rainAmount < 0 || rainAmount > 1) {
      throw new RangeError('Smoke needs non-negative elapsed time and rain amount between zero and one');
    }
    elapsed += deltaSeconds;
    const lifetime = THREE.MathUtils.lerp(3.2, 2.2, rainAmount);
    while (spawnIndex * SPAWN_INTERVAL <= elapsed + 1e-9) {
      const birth = spawnIndex++ * SPAWN_INTERVAL;
      for (const puff of puffs) {
        if (puff.alive && birth - puff.born >= lifetime - 1e-9) puff.alive = false;
      }
      // Five slots and a 3.2 s lifetime cannot accommodate every 0.6 s birth.
      // Skip a scheduled birth rather than cutting an existing puff short.
      const available = puffs.find((puff) => !puff.alive);
      if (available) {
        available.alive = true;
        available.born = birth;
        orient(available);
      }
    }

    chimney!.getWorldPosition(origin);
    for (const puff of puffs) {
      // A tick can be reached within floating-point tolerance a fraction early.
      const age = Math.max(0, elapsed - puff.born);
      if (age >= lifetime - 1e-9) puff.alive = false;
      puff.mesh.visible = puff.alive;
      if (!puff.alive) continue;
      const progress = age / lifetime;
      puff.mesh.position.set(origin.x + WIND.x * age, origin.y + 0.5 * age, origin.z + WIND.z * age);
      puff.mesh.scale.setScalar(THREE.MathUtils.lerp(0.22, 0.5, progress));
      puff.material.opacity = 0.55 * (1 - progress) * (1 - 0.4 * rainAmount);
    }
  }

  function dispose() {
    scene.remove(root);
    geometry.dispose();
    for (const puff of puffs) puff.material.dispose();
  }

  // Start with a settled plume instead of a three-second empty chimney.
  update(0, 0);
  return { update, dispose };
}
