import * as THREE from 'three';
import { createVisualRandom } from './createVisualRandom';

const CAPACITY = 6;
const SPAWN_INTERVAL = 0.55;
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
      color: 0xefe3c8, emissive: 0x000000, roughness: 1, flatShading: true,
      transparent: true, opacity: 0, depthWrite: false,
    });
    // The signed scene is very dim at night. Lift only its reflected light so
    // the puffs remain legible, then cap it to the specified albedo without
    // changing the light hue. There is no emissive term or light added here.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        vec3 smokeLit = outgoingLight * 9.0;
        vec3 smokeLimit = max(diffuseColor.rgb, vec3(0.0001));
        float smokeCap = max(1.0, max(max(smokeLit.r / smokeLimit.r, smokeLit.g / smokeLimit.g), smokeLit.b / smokeLimit.b));
        outgoingLight = smokeLit / smokeCap;
        #include <opaque_fragment>
      `);
    };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `chimney-smoke-${index + 1}`;
    mesh.raycast = () => {};
    root.add(mesh);
    return { mesh, material, born: -index * SPAWN_INTERVAL, alive: true };
  });

  function orient(puff: (typeof puffs)[number]) {
    // Quarter turns retain the measured 0.28–0.65 bounding dimensions.
    puff.mesh.rotation.y = Math.floor(random() * 4) * Math.PI / 2;
  }
  puffs.forEach(orient);

  const origin = new THREE.Vector3();
  let elapsed = 0;
  let spawnIndex = 1;

  function update(deltaSeconds: number, rainAmount: number, nightAmount: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 ||
      [rainAmount, nightAmount].some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 1)) {
      throw new RangeError('Smoke needs non-negative elapsed time and valid rain/night amounts');
    }
    elapsed += deltaSeconds;
    const lifetime = THREE.MathUtils.lerp(3.6, 2.6, rainAmount);
    while (spawnIndex * SPAWN_INTERVAL <= elapsed + 1e-9) {
      const birth = spawnIndex++ * SPAWN_INTERVAL;
      for (const puff of puffs) {
        if (puff.alive && birth - puff.born >= lifetime - 1e-9) puff.alive = false;
      }
      // Six slots and a 3.6 s lifetime cannot accommodate every 0.55 s birth.
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
      puff.mesh.position.set(origin.x + WIND.x * age, origin.y + 0.45 * age, origin.z + WIND.z * age);
      puff.mesh.scale.setScalar(THREE.MathUtils.lerp(0.28, 0.65, Math.pow(progress, 1.5)));
      // Hold the peak through 90% of life, then ease continuously to zero.
      const eased = THREE.MathUtils.smoothstep(progress, 0.9, 1);
      const fade = 1 - eased ** 4;
      // Both rain and night individually dim to 60%; together they do not
      // double-dim the plume below that floor.
      const dim = 1 - 0.4 * Math.max(rainAmount, nightAmount);
      puff.material.opacity = 0.75 * fade * dim;
    }
  }

  function dispose() {
    scene.remove(root);
    geometry.dispose();
    for (const puff of puffs) puff.material.dispose();
  }

  // Start with a settled plume instead of a three-second empty chimney.
  update(0, 0, 0);
  return { update, dispose };
}
