import * as THREE from 'three';
import { GROUND_HEIGHT, GROUND_SIZE } from './createIsland';
import { WATER_FEATURE } from '../content/waterFeature';
import { ART_SLOTS } from '../content/slots';

/** Lit, non-emissive sheet with vertex alpha fading into the existing void. */
export function createWaterfall(parent: THREE.Group) {
  const { waterfall, stream } = WATER_FEATURE;
  const palette = ART_SLOTS.palette.water;
  const top = GROUND_HEIGHT;
  const bottom = waterfall.bottom;
  const fadeStart = bottom + waterfall.fadeHeight;
  const faceZ = GROUND_SIZE / 2 + waterfall.faceOffset;
  const alpha = (y: number) => THREE.MathUtils.clamp((y - bottom) / waterfall.fadeHeight, 0, 1);
  // Engineer: upward-tilted water normals catch the existing sun/moon on the
  // vertical sheet. It still darkens with the scene and emits no light.
  function waterNormals(geometry: THREE.BufferGeometry) {
    geometry.computeVertexNormals();
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, Math.SQRT1_2, Math.SQRT1_2);
    normal.needsUpdate = true;
  }
  function brightenReflectedLight(material: THREE.MeshStandardMaterial) {
    // Engineer: retain locked colors and zero emissive, but amplify the light
    // already reflected by the sheet so its pale streaks survive night pixels.
    // With no scene lighting the result remains black, unlike an emissive pass.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight *= 2.0;\n#include <opaque_fragment>');
    };
  }

  const lip = new THREE.Mesh(
    new THREE.PlaneGeometry(waterfall.width, waterfall.lipDepth),
    new THREE.MeshStandardMaterial({ color: palette.foam, roughness: 0.25 }),
  );
  lip.name = 'farm-waterfall-lip';
  lip.rotation.x = -Math.PI / 2;
  lip.position.set(waterfall.x, GROUND_HEIGHT + stream.foamLift, GROUND_SIZE / 2 - waterfall.lipDepth / 2);
  parent.add(lip);

  const topColor = new THREE.Color(palette.water);
  const bottomColor = new THREE.Color(palette.fallBottom);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const y of [top, fadeStart, bottom]) {
    const color = topColor.clone().lerp(bottomColor, (top - y) / (top - bottom));
    for (const x of [-waterfall.width / 2, waterfall.width / 2]) {
      positions.push(x, y, 0);
      colors.push(color.r, color.g, color.b, alpha(y));
    }
  }
  indices.push(0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setIndex(indices);
  waterNormals(geometry);
  const material = new THREE.MeshStandardMaterial({
    color: ART_SLOTS.palette.vertexWhite, vertexColors: true, roughness: 0.25, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  brightenReflectedLight(material);
  const face = new THREE.Mesh(geometry, material);
  face.name = 'farm-waterfall-face';
  face.position.set(waterfall.x, 0, faceZ);
  parent.add(face);

  const streakGeometry = new THREE.BufferGeometry();
  const streakMaterial = new THREE.MeshStandardMaterial({
    color: palette.streak, vertexColors: true, roughness: 0.25, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  brightenReflectedLight(streakMaterial);
  const streaks = new THREE.Mesh(streakGeometry, streakMaterial);
  streaks.name = 'farm-waterfall-streaks';
  streaks.position.set(waterfall.x, 0, faceZ + waterfall.streakLayerOffset);
  streaks.frustumCulled = false;
  parent.add(streaks);

  let elapsed = 0;
  let lastStep = -1;
  function update(deltaSeconds: number) {
    elapsed += Math.max(0, deltaSeconds);
    const step = Math.floor((elapsed * waterfall.speed + 1e-9) / waterfall.step);
    if (step === lastStep) return;
    lastStep = step;
    const scroll = step * waterfall.step;
    const vertices: number[] = [];
    const vertexColors: number[] = [];
    const period = waterfall.streakPeriod; // Engineer: visible short streaks, scrolled in 0.1-unit steps.
    const length = waterfall.streakLength;
    const columns = Math.round(waterfall.width / waterfall.streakSpacing);
    function quad(left: number, right: number, upper: number, lower: number) {
      for (const [x, y] of [[left, upper], [left, lower], [right, upper], [right, upper], [left, lower], [right, lower]]) {
        vertices.push(x, y, 0);
        vertexColors.push(1, 1, 1, alpha(y));
      }
    }
    for (let column = 0; column < columns; column++) {
      const center = -waterfall.width / 2 + (column + 0.5) * waterfall.streakSpacing;
      const phase = (scroll + column * waterfall.streakColumnPhase) % period;
      for (let row = -1; row <= Math.ceil((top - bottom) / period); row++) {
        const upper = Math.min(top, top - row * period - phase);
        const lower = Math.max(bottom, top - row * period - phase - length);
        if (upper <= lower) continue;
        const left = center - waterfall.streakWidth / 2;
        const right = center + waterfall.streakWidth / 2;
        if (upper > fadeStart && lower < fadeStart) {
          quad(left, right, upper, fadeStart);
          quad(left, right, fadeStart, lower);
        } else quad(left, right, upper, lower);
      }
    }
    streakGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    streakGeometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 4));
    waterNormals(streakGeometry);
  }
  update(0);
  return update;
}
