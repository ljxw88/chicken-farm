import * as THREE from 'three';
import { CONTACT_SHADOW_COLOR } from '../scene/contactShadowStyle';

export const CHARACTER_RADIUS = 0.4;
const BODY_LENGTH = 0.6;
const CROWN_LIFT = 0.15;
const DAY_CROWN_LIFT = 0.28;
const DAY_BASE_GAIN = 1.08;

function applyCrownLift(geometry: THREE.BufferGeometry, lift: number, baseGain: number) {
  const positions = geometry.getAttribute('position');
  const colors = geometry.getAttribute('color');
  for (let i = 0; i < positions.count; i++) {
    // A rotation-independent lighter crown helps the sun/moon read from
    // above without adding an emissive or camera-facing light.
    const t = THREE.MathUtils.clamp((positions.getY(i) + 0.05) / 0.7, 0, 1);
    const value = baseGain * (1 + lift * THREE.MathUtils.smoothstep(t, 0, 1));
    colors.setXYZ(i, value, value, value);
  }
  colors.needsUpdate = true;
}

export function createCharacterCrownController(character: THREE.Object3D) {
  const body = character.children.find((child) => child instanceof THREE.Mesh && child.geometry.type === 'CapsuleGeometry');
  let currentDaytimeAmount = 0;
  let currentBaseAmount = 0;
  return (daytimeAmount: number, cloudyAmount: number) => {
    const baseAmount = daytimeAmount * (1 - cloudyAmount);
    if (!(body instanceof THREE.Mesh) || (daytimeAmount === currentDaytimeAmount && baseAmount === currentBaseAmount)) return;
    const lift = THREE.MathUtils.lerp(CROWN_LIFT, DAY_CROWN_LIFT, daytimeAmount);
    // Uniform linear RGB preserves the signed yellow hue, without emission.
    // Fade out the extra base gain in cloud to retain shade/grass separation.
    const baseGain = THREE.MathUtils.lerp(1, DAY_BASE_GAIN, baseAmount);
    applyCrownLift(body.geometry, lift, baseGain);
    currentDaytimeAmount = daytimeAmount;
    currentBaseAmount = baseAmount;
  };
}

export function createCharacter() {
  // The group's origin is at the character's feet on the ground plane.
  const character = new THREE.Group();
  character.name = 'character';

  const bodyGeometry = new THREE.CapsuleGeometry(CHARACTER_RADIUS, BODY_LENGTH, 6, 12);
  const positions = bodyGeometry.getAttribute('position');
  bodyGeometry.setAttribute('color', new THREE.Float32BufferAttribute(positions.count * 3, 3));
  applyCrownLift(bodyGeometry, CROWN_LIFT, 1);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffd477, roughness: 0.9, vertexColors: true });
  // Engineer: keep the signed base/crown and retune only key-away shading.
  // Warmer indirect bounce preserves directional contrast after the azimuth
  // change; at night the cool blue/green shade contribution is reduced.
  bodyMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', `
      #include <lights_fragment_begin>
      #if defined( RE_IndirectDiffuse ) && NUM_DIR_LIGHTS > 0
        float keyFacing = dot( geometryNormal, directionalLights[ 0 ].direction );
        float shade = 1.0 - smoothstep( 0.0, 0.45, keyFacing );
        vec3 worldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
        shade *= 1.0 - smoothstep( 0.35, 0.65, worldNormal.y );
        vec3 keyColor = directionalLights[ 0 ].color;
        float daytime = smoothstep( 0.65, 0.9, max( keyColor.r, max( keyColor.g, keyColor.b ) ) );
        vec3 bounce = mix( vec3( 3.00, 0.00, 0.00 ), vec3( 4.50, 2.80, 0.80 ), daytime );
        irradiance = mix( irradiance, irradiance * bounce, 0.30 * shade );
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      #if defined( RE_IndirectDiffuse ) && NUM_DIR_LIGHTS > 0
        outgoingLight.g *= 1.0 - 0.03 * shade * ( 1.0 - daytime );
        outgoingLight.b *= 1.0 - 0.30 * shade * ( 1.0 - daytime );
      #endif
      #include <opaque_fragment>
    `);
  };
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = CHARACTER_RADIUS + BODY_LENGTH / 2;
  character.add(body);

  // A little face makes the direction of travel visible.
  const eyeGeometry = new THREE.SphereGeometry(0.045, 10, 8);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x302820 });
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(x, 1.04, 0.38);
    character.add(eye);
  }

  const beak = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xe99049, roughness: 0.9 }),
  );
  beak.scale.set(0.13, 0.09, 0.13);
  beak.position.set(0, 0.85, 0.4);
  character.add(beak);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(CHARACTER_RADIUS, 24),
    // Dark green-black follows main's tree contacts without brightening night ground.
    new THREE.MeshBasicMaterial({ color: CONTACT_SHADOW_COLOR, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  shadow.name = 'character-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.y = 0.7;
  // Stay above the slightly raised dirt path without changing the walking height.
  shadow.position.y = 0.04;
  character.add(shadow);

  return character;
}
