import * as THREE from 'three';
import { CHARACTER_RADIUS, createCharacterCrownController } from '../character/createCharacter';
import { createPracticalLights, type EmissiveAccent, type WindowPane } from './createPracticalLights';
import { createSunsetWaterTint } from './createSunsetWaterTint';
import { DAY_NIGHT_PHASES, DEFAULT_DAY_NIGHT_CYCLE_SECONDS, type DayNightPhaseName } from './dayNightPhases';

// THREE.Color converts the locked sRGB hex values to its linear working space.
const phaseColors = DAY_NIGHT_PHASES.map((phase) => ({
  fog: new THREE.Color(phase.fog),
  ambient: new THREE.Color(phase.ambient),
  hemisphereSky: new THREE.Color(phase.hemisphereSky),
  hemisphereGround: new THREE.Color(phase.hemisphereGround),
  directional: new THREE.Color(phase.directional),
}));
// Engineer: use Look Dev's camera-side endpoint while retaining the original
// horizontal radius, so rotating the azimuth does not change the elevation.
const KEY_RADIUS = Math.hypot(11, 4);
const KEY_X = -0.8 * KEY_RADIUS;
const KEY_Z = 0.6 * KEY_RADIUS;

interface DayNightCycleOptions {
  scene: THREE.Scene;
  character: THREE.Object3D;
  windows: readonly WindowPane[];
  extraEmissives?: readonly EmissiveAccent[];
  shadowSupported?: (x: number, z: number, radius: number) => boolean;
  updateFarmShadows?: (awayX: number, awayZ: number, offset: number, strength: number) => void;
}

export function createDayNightCycle({ scene, character, windows, extraEmissives, shadowSupported, updateFarmShadows }: DayNightCycleOptions) {
  const morning = DAY_NIGHT_PHASES[0];
  // The scene owns the fixed diorama void; phases still drive fog and lights.
  const fog = new THREE.FogExp2(morning.fog, morning.fogDensity);
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

  const practicalLights = createPracticalLights(character, windows, extraEmissives);
  const setSunsetWaterTint = createSunsetWaterTint(scene);
  const setCharacterDaytimeCrown = createCharacterCrownController(character);
  const characterShadow = character.getObjectByName('character-shadow');
  const lightDirection = new THREE.Vector3();
  const targetPosition = new THREE.Vector3();
  const localShadowDirection = new THREE.Vector3();
  const characterWorldPosition = new THREE.Vector3();
  const characterRotation = new THREE.Quaternion();
  let cycleSeconds = DEFAULT_DAY_NIGHT_CYCLE_SECONDS;
  let progress = 0;
  let daytimeCrownAmount = 0;
  let directionalMultiplier = 1;
  let directionalBaseIntensity: number = morning.directionalIntensity;
  let ambientBaseIntensity: number = morning.ambientIntensity;
  let hemisphereBaseIntensity: number = morning.hemisphereIntensity;
  let nightAmount: number = morning.nightLights;
  let shadowOffset: number = morning.shadowOffset;
  let shadowOpacity: number = morning.shadowOpacity;
  let rainAmount = 0;
  let cloudyAmount = 0;
  const ambientBaseColor = new THREE.Color();
  const hemisphereSkyBaseColor = new THREE.Color();
  const hemisphereGroundBaseColor = new THREE.Color();
  const ambientHemisphereColorMultiplier = new THREE.Color(1, 1, 1);

  function applyAmbientHemisphereColors() {
    ambient.color.copy(ambientBaseColor).multiply(ambientHemisphereColorMultiplier);
    hemisphere.color.copy(hemisphereSkyBaseColor).multiply(ambientHemisphereColorMultiplier);
    hemisphere.groundColor.copy(hemisphereGroundBaseColor).multiply(ambientHemisphereColorMultiplier);
  }

  function applyFillIntensities() {
    // At night the weather also softens the fill, so the dimmed moon remains
    // the key in rain/cloud rather than an omnidirectional front light.
    const scale = 1 - nightAmount * (0.2 * rainAmount + 0.18 * cloudyAmount);
    ambient.intensity = ambientBaseIntensity * scale;
    hemisphere.intensity = hemisphereBaseIntensity * scale;
  }

  function updateCharacterShadow() {
    if (!characterShadow) return;
    // DirectionalLight points from its world position to its target. Project
    // a short, stylized ground shadow away from that same sun/moon direction.
    // Keep it in world space even though the contact mesh is character-parented
    // and the character can turn independently of the light.
    directional.getWorldPosition(lightDirection);
    directional.target.getWorldPosition(targetPosition);
    lightDirection.sub(targetPosition);
    const horizontal = Math.hypot(lightDirection.x, lightDirection.z);
    if (horizontal < 1e-6) {
      characterShadow.position.x = 0;
      characterShadow.position.z = 0;
      characterShadow.scale.x = 1;
      return;
    }
    // Overcast contact shadows are half as long/strong; rain is nearly
    // centered and faint. The envelopes crossfade with the weather system.
    let offset = shadowOffset * (1 - 0.5 * cloudyAmount - 0.51 * rainAmount);
    const awayX = -lightDirection.x / horizontal;
    const awayZ = -lightDirection.z / horizontal;
    const opacity = shadowOpacity * (1 - 0.5 * cloudyAmount - 0.8 * rainAmount);
    updateFarmShadows?.(awayX, awayZ, offset, opacity / 0.22);
    if (shadowSupported) {
      character.getWorldPosition(characterWorldPosition);
      // The entire ellipse fits inside this conservative enclosing circle.
      // Shorten it continuously near island/stair edges instead of drawing a
      // dark shape out over the void. The existing contact shadow stays.
      const supported = (distance: number) => shadowSupported(
        characterWorldPosition.x + awayX * distance,
        characterWorldPosition.z + awayZ * distance,
        CHARACTER_RADIUS + distance,
      );
      if (!supported(offset)) {
        let low = 0;
        let high = offset;
        for (let i = 0; i < 10; i++) {
          const middle = (low + high) / 2;
          if (supported(middle)) low = middle;
          else high = middle;
        }
        offset = low;
      }
    }
    localShadowDirection.set(awayX, 0, awayZ);
    character.getWorldQuaternion(characterRotation);
    localShadowDirection.applyQuaternion(characterRotation.invert());
    characterShadow.position.x = localShadowDirection.x * offset;
    characterShadow.position.z = localShadowDirection.z * offset;
    // The circle's local +X is the major axis after the -90° X rotation.
    characterShadow.rotation.z = Math.atan2(-localShadowDirection.z, localShadowDirection.x);
    characterShadow.scale.x = 1 + offset / CHARACTER_RADIUS;
    if (characterShadow instanceof THREE.Mesh && characterShadow.material instanceof THREE.MeshBasicMaterial) {
      characterShadow.material.opacity = opacity;
    }
  }

  function setShadowWeather(rain: number, cloudy: number) {
    if ([rain, cloudy].some((value) => !Number.isFinite(value) || value < 0 || value > 1) || rain + cloudy > 1 + 1e-9) {
      throw new RangeError('Shadow weather amounts must be between zero and one and sum to at most one');
    }
    rainAmount = rain;
    cloudyAmount = cloudy;
    setCharacterDaytimeCrown(daytimeCrownAmount, cloudyAmount);
    applyFillIntensities();
    updateCharacterShadow();
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
    // Fade only into and out of the sunset anchor; other phase anchors are unchanged.
    setSunsetWaterTint((from.name === 'sunset' ? 1 - blend : 0) + (to.name === 'sunset' ? blend : 0));
    // Preserve the signed morning/sunset/night crowns, and blend the daytime
    // contrast lift with the same smooth phase interpolation as the lighting.
    daytimeCrownAmount = (from.name === 'daytime' ? 1 - blend : 0) + (to.name === 'daytime' ? blend : 0);
    setCharacterDaytimeCrown(daytimeCrownAmount, cloudyAmount);

    fog.color.copy(fromColors.fog).lerp(toColors.fog, blend);
    fog.density = lerp(from.fogDensity, to.fogDensity, blend);
    ambientBaseColor.copy(fromColors.ambient).lerp(toColors.ambient, blend);
    ambientBaseIntensity = lerp(from.ambientIntensity, to.ambientIntensity, blend);
    hemisphereSkyBaseColor.copy(fromColors.hemisphereSky).lerp(toColors.hemisphereSky, blend);
    hemisphereGroundBaseColor.copy(fromColors.hemisphereGround).lerp(toColors.hemisphereGround, blend);
    applyAmbientHemisphereColors();
    hemisphereBaseIntensity = lerp(from.hemisphereIntensity, to.hemisphereIntensity, blend);
    directional.color.copy(fromColors.directional).lerp(toColors.directional, blend);
    directionalBaseIntensity = lerp(from.directionalIntensity, to.directionalIntensity, blend);
    directional.intensity = directionalBaseIntensity * directionalMultiplier;
    shadowOffset = lerp(from.shadowOffset, to.shadowOffset, blend);
    shadowOpacity = lerp(from.shadowOpacity, to.shadowOpacity, blend);
    nightAmount = lerp(from.nightLights, to.nightLights, blend);
    applyFillIntensities();
    practicalLights.setNightAmount(nightAmount);

    // All phases use the same upper-left azimuth. Only the elevation changes:
    // low morning/sunset sun, higher daytime sun, and a cool moon at night.
    const angle = progress * Math.PI * 2;
    const height = Math.sin(angle);
    const moonArc = Math.min(0, height) ** 2;
    directional.position.set(KEY_X, 4 + 8 * Math.max(0, height) + 5 * moonArc, KEY_Z);
    updateCharacterShadow();
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
    update,
    setDayNightCycleSeconds,
    setDayNightPhase,
    setDirectionalIntensityMultiplier,
    setAmbientHemisphereColorMultiplier,
    setShadowWeather,
    updateCharacterShadow,
    getPhase: () => DAY_NIGHT_PHASES[Math.floor(progress * DAY_NIGHT_PHASES.length)].name,
  };
}
