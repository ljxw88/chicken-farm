import * as THREE from 'three';
import { createVisualRandom } from './createVisualRandom';
import { CHIMNEY_SMOKE } from '../content/effects';
import { ART_SLOTS } from '../content/slots';
import { VISUAL_SEEDS } from '../content/startup';

const CAPACITY = CHIMNEY_SMOKE.capacity;
const SPAWN_INTERVAL = CHIMNEY_SMOKE.spawnInterval;
const WIND = new THREE.Vector3(...CHIMNEY_SMOKE.wind).normalize().multiplyScalar(CHIMNEY_SMOKE.windSpeed);
const SWAY_AMPLITUDE = CHIMNEY_SMOKE.swayAmplitude;
const SWAY_SPEED = CHIMNEY_SMOKE.swaySpeed;

export interface SmokeSlots {
  color: number; emissive: number; initialOpacity: number; peakOpacity: number; weatherNightDimming: number; roughness: number;
}
const DEFAULT_SLOTS: SmokeSlots = { ...ART_SLOTS.palette.smoke, ...ART_SLOTS.prop.smoke };

interface ChimneySmokeOptions {
  scene: THREE.Scene;
  random?: () => number;
  slots?: SmokeSlots;
}

/** Visual-only smoke; the named anchor belongs to the existing cottage. */
export function createChimneySmoke({ scene, random = createVisualRandom(VISUAL_SEEDS.smoke),
  slots = DEFAULT_SLOTS }: ChimneySmokeOptions) {
  const chimney = scene.getObjectByName('cottage-chimney-top');
  if (!chimney) throw new Error('Cottage chimney anchor not found');

  const root = new THREE.Group();
  root.name = 'chimney-smoke';
  scene.add(root);

  // Normalize the icosahedron's bounding box to one unit, so the scale below
  // is the actual world-space puff width, not the radius of its circumsphere.
  const geometry = new THREE.IcosahedronGeometry(...CHIMNEY_SMOKE.puffGeometry);
  geometry.computeBoundingBox();
  const dimensions = geometry.boundingBox!.getSize(new THREE.Vector3());
  geometry.scale(1 / dimensions.x, 1 / dimensions.y, 1 / dimensions.z);
  const puffs = Array.from({ length: CAPACITY }, (_, index) => {
    const material = new THREE.MeshStandardMaterial({
      color: slots.color, emissive: slots.emissive, roughness: slots.roughness, flatShading: true,
      transparent: true, opacity: slots.initialOpacity, depthWrite: false,
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
    return { mesh, material, born: -index * SPAWN_INTERVAL, alive: true, sizeFactor: 1, swayPhase: 0 };
  });

  function initializePuff(puff: (typeof puffs)[number]) {
    // Split the existing draw so orientation keeps its original random stream.
    const draw = random();
    const bits = Math.floor(draw * 0x100000000);
    puff.mesh.rotation.y = Math.floor(draw * 4) * Math.PI / 2;
    puff.sizeFactor = CHIMNEY_SMOKE.sizeFactorMin + CHIMNEY_SMOKE.sizeFactorRange * ((bits >>> 15) & 0x7fff) / 0x8000;
    puff.swayPhase = 2 * Math.PI * (bits & 0x7fff) / 0x8000;
  }
  puffs.forEach(initializePuff);

  const origin = new THREE.Vector3();
  let elapsed = 0;
  let spawnIndex = 1;

  function update(deltaSeconds: number, rainAmount: number, nightAmount: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 ||
      [rainAmount, nightAmount].some((amount) => !Number.isFinite(amount) || amount < 0 || amount > 1)) {
      throw new RangeError('Smoke needs non-negative elapsed time and valid rain/night amounts');
    }
    elapsed += deltaSeconds;
    const lifetime = THREE.MathUtils.lerp(...CHIMNEY_SMOKE.lifetime, rainAmount);
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
        initializePuff(available);
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
      const sway = SWAY_AMPLITUDE * Math.sin(age * SWAY_SPEED + puff.swayPhase);
      puff.mesh.position.set(origin.x + WIND.x * age + sway, origin.y + CHIMNEY_SMOKE.riseSpeed * age, origin.z + WIND.z * age);
      puff.mesh.scale.setScalar(THREE.MathUtils.lerp(...CHIMNEY_SMOKE.size, Math.pow(progress, CHIMNEY_SMOKE.sizeExponent)) * puff.sizeFactor);
      // Hold the peak through 40% of life, then ease continuously to zero.
      const fade = 1 - THREE.MathUtils.smoothstep(progress, CHIMNEY_SMOKE.fadeStart, 1);
      // Both rain and night individually dim to 60%; together they do not
      // double-dim the plume below that floor.
      const dim = 1 - slots.weatherNightDimming * Math.max(rainAmount, nightAmount);
      puff.material.opacity = slots.peakOpacity * fade * dim;
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
