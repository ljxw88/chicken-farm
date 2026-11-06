import * as THREE from 'three';
import { createPracticalLights, type WindowPane } from './createPracticalLights';
import { DAY_NIGHT_PHASES, DEFAULT_DAY_NIGHT_CYCLE_SECONDS, type DayNightPhaseName } from './dayNightPhases';

// THREE.Color converts the locked sRGB hex values to its linear working space.
const phaseColors = DAY_NIGHT_PHASES.map((phase) => ({
  sky: new THREE.Color(phase.sky),
  fog: new THREE.Color(phase.fog),
  ambient: new THREE.Color(phase.ambient),
  hemisphereSky: new THREE.Color(phase.hemisphereSky),
  hemisphereGround: new THREE.Color(phase.hemisphereGround),
  directional: new THREE.Color(phase.directional),
}));

interface DayNightCycleOptions {
  scene: THREE.Scene;
  character: THREE.Object3D;
  windows: readonly WindowPane[];
}

export function createDayNightCycle({ scene, character, windows }: DayNightCycleOptions) {
  const morning = DAY_NIGHT_PHASES[0];
  const background = new THREE.Color(morning.sky);
  const fog = new THREE.FogExp2(morning.fog, morning.fogDensity);
  scene.background = background;
  scene.fog = fog;

  const ambient = new THREE.AmbientLight(morning.ambient, morning.ambientIntensity);
  ambient.name = 'day-night-ambient';
  const hemisphere = new THREE.HemisphereLight(
    morning.hemisphereSky,
    morning.hemisphereGround,
    morning.hemisphereIntensity,
  );
  hemisphere.name = 'day-night-hemisphere';
  const directional = new THREE.DirectionalLight(morning.directional, morning.directionalIntensity);
  directional.name = 'day-night-directional';
  scene.add(ambient, hemisphere, directional);

  const practicalLights = createPracticalLights(character, windows);
  let cycleSeconds = DEFAULT_DAY_NIGHT_CYCLE_SECONDS;
  let progress = 0;
  let directionalMultiplier = 1;
  let directionalBaseIntensity: number = morning.directionalIntensity;
  const ambientBaseColor = new THREE.Color();
  const hemisphereSkyBaseColor = new THREE.Color();
  const hemisphereGroundBaseColor = new THREE.Color();
  const ambientHemisphereColorMultiplier = new THREE.Color(1, 1, 1);

  function applyAmbientHemisphereColors() {
    ambient.color.copy(ambientBaseColor).multiply(ambientHemisphereColorMultiplier);
    hemisphere.color.copy(hemisphereSkyBaseColor).multiply(ambientHemisphereColorMultiplier);
    hemisphere.groundColor.copy(hemisphereGroundBaseColor).multiply(ambientHemisphereColorMultiplier);
  }

  function applyLighting() {
    const phasePosition = progress * DAY_NIGHT_PHASES.length;
    const index = Math.floor(phasePosition);
    const nextIndex = (index + 1) % DAY_NIGHT_PHASES.length;
    const from = DAY_NIGHT_PHASES[index];
    const to = DAY_NIGHT_PHASES[nextIndex];
    const fromColors = phaseColors[index];
    const toColors = phaseColors[nextIndex];
    const blend = THREE.MathUtils.smoothstep(phasePosition - index, 0, 1);
    const lerp = THREE.MathUtils.lerp;

    background.copy(fromColors.sky).lerp(toColors.sky, blend);
    fog.color.copy(fromColors.fog).lerp(toColors.fog, blend);
    fog.density = lerp(from.fogDensity, to.fogDensity, blend);
    ambientBaseColor.copy(fromColors.ambient).lerp(toColors.ambient, blend);
    ambient.intensity = lerp(from.ambientIntensity, to.ambientIntensity, blend);
    hemisphereSkyBaseColor.copy(fromColors.hemisphereSky).lerp(toColors.hemisphereSky, blend);
    hemisphereGroundBaseColor.copy(fromColors.hemisphereGround).lerp(toColors.hemisphereGround, blend);
    applyAmbientHemisphereColors();
    hemisphere.intensity = lerp(from.hemisphereIntensity, to.hemisphereIntensity, blend);
    directional.color.copy(fromColors.directional).lerp(toColors.directional, blend);
    directionalBaseIntensity = lerp(from.directionalIntensity, to.directionalIntensity, blend);
    directional.intensity = directionalBaseIntensity * directionalMultiplier;
    practicalLights.setNightAmount(lerp(from.nightLights, to.nightLights, blend));

    // The sun rises and sets low; the moon follows the other half of the arc
    // above the ground and toward the camera-facing side of the character.
    const angle = progress * Math.PI * 2;
    const height = Math.sin(angle);
    const moonArc = Math.min(0, height) ** 2;
    directional.position.set(Math.cos(angle) * 12 + 6 * moonArc, 3 + 9 * height * height, height * 6 + 12 * moonArc);
  }

  function update(deltaSeconds: number) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('Day/night elapsed time must be a finite, non-negative number');
    }
    progress = (progress + (deltaSeconds % cycleSeconds) / cycleSeconds) % 1;
    applyLighting();
  }

  function setDayNightCycleSeconds(seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new RangeError('Day/night cycle length must be a finite number greater than zero');
    }
    // Preserve the current phase when the cycle speed changes.
    cycleSeconds = seconds;
  }

  function setDayNightPhase(name: DayNightPhaseName) {
    const index = DAY_NIGHT_PHASES.findIndex((phase) => phase.name === name);
    if (index < 0) throw new RangeError(`Unknown day/night phase: ${name}`);
    progress = index / DAY_NIGHT_PHASES.length;
    applyLighting();
  }

  function setDirectionalIntensityMultiplier(multiplier: number) {
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1) {
      throw new RangeError('Directional intensity multiplier must be between zero and one');
    }
    directionalMultiplier = multiplier;
    // Always scale the current phase value, never an already-scaled light.
    directional.intensity = directionalBaseIntensity * directionalMultiplier;
  }

  function setAmbientHemisphereColorMultiplier(red: number, green: number, blue: number) {
    if ([red, green, blue].some((value) => !Number.isFinite(value) || value < 0)) {
      throw new RangeError('Ambient and hemisphere color multipliers must be finite and non-negative');
    }
    ambientHemisphereColorMultiplier.setRGB(red, green, blue);
    // Reapply to the current phase colors, never to already-tinted colors.
    applyAmbientHemisphereColors();
  }

  applyLighting();
  return {
    update, setDayNightCycleSeconds, setDayNightPhase,
    setDirectionalIntensityMultiplier, setAmbientHemisphereColorMultiplier,
  };
}
