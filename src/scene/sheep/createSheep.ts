import * as THREE from 'three';
import { ART_SLOTS, type SheepSlots } from '../../content/slots';
import { SHEEP_GEOMETRY } from '../../content/sheep';

// The two existing chicken feather colours flank Look Dev's approved wool base.
export const SHEEP_WOOL = { top: ART_SLOTS.palette.sheep.woolTop, base: ART_SLOTS.palette.sheep.woolBase,
  shade: ART_SLOTS.palette.sheep.woolShade } as const;
export const SHEEP_NOD_PERIOD = SHEEP_GEOMETRY.nodPeriod;
export const SHEEP_NOD_ANGLE = THREE.MathUtils.degToRad(SHEEP_GEOMETRY.nodDegrees);

function woolMaterial(color: number) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
  // Keep the approved albedo and directional shading, but roll back only
  // overexposed highlights before output conversion. 0.9 linear is ~243 sRGB.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      #if NUM_DIR_LIGHTS > 0
        // The moon is the only blue-biased key. Counter its cool cast on wool
        // without changing the approved albedo, daytime light, or any lights.
        vec3 woolKey = directionalLights[0].color;
        float moonWool = smoothstep(0.0, 0.12, woolKey.b - woolKey.r);
        outgoingLight *= mix(vec3(1.0), vec3(1.60, 1.00, 0.70), moonWool);
      #endif
      float woolPeak = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
      outgoingLight *= min(1.0, 0.9 / max(woolPeak, 0.0001));
      #include <opaque_fragment>
    `);
  };
  return material;
}

/** Origin at the feet, facing local +Z. The caller supplies a seeded phase. */
export function createSheep(variant: 0 | 1, phase: number, slots: SheepSlots = ART_SLOTS.palette.sheep) {
  const group = new THREE.Group();
  group.name = `sheep-${variant + 1}`;
  // Slightly turn the local +Z front so the elongated profile survives the
  // isometric pixel pass while remaining within the approved facing range.
  group.rotation.y = THREE.MathUtils.degToRad(SHEEP_GEOMETRY.turnDegrees[variant]);

  const wool = [woolMaterial(slots.woolShade), woolMaterial(slots.woolBase), woolMaterial(slots.woolTop)];
  const lobeGeometry = new THREE.IcosahedronGeometry(...SHEEP_GEOMETRY.woolGeometry);
  // Three low-poly lobes form a long, shallow fleece above the visible legs.
  // Their offsets differ between the animals without recolouring the wool.
  SHEEP_GEOMETRY.woolLobes[variant].forEach(([x, y, z, sx, sy, sz], index) => {
    const lobe = new THREE.Mesh(lobeGeometry, wool[index]);
    lobe.name = `sheep-${variant + 1}-wool-${index + 1}`;
    lobe.position.set(x, y, z);
    lobe.scale.set(sx, sy, sz);
    group.add(lobe);
  });

  const brown = new THREE.MeshStandardMaterial({ color: slots.brown, roughness: 1 });
  const detail = new THREE.MeshStandardMaterial({ color: slots.detail, roughness: 1 });
  const legGeometry = new THREE.BoxGeometry(...SHEEP_GEOMETRY.leg);
  for (const x of SHEEP_GEOMETRY.legXs) for (const z of SHEEP_GEOMETRY.legZs) {
    const leg = new THREE.Mesh(legGeometry, brown);
    leg.name = `sheep-${variant + 1}-leg`;
    // Stagger the second sheep's near rear leg slightly so it remains visible
    // behind the unchanged fence at the 320×180 game resolution.
    leg.position.set(x, SHEEP_GEOMETRY.legY, variant === 1 && x > 0 && z < 0 ? SHEEP_GEOMETRY.secondRearLegZ : z);
    group.add(leg);
  }

  const head = new THREE.Group();
  head.name = `sheep-${variant + 1}-head-pivot`;
  head.position.set(...SHEEP_GEOMETRY.headPosition);
  group.add(head);
  const faceGeometry = new THREE.BoxGeometry(...SHEEP_GEOMETRY.face);
  let faceMaterial = brown;
  if (variant === 1) {
    // Retain the trunk-brown token while shading the second face slightly darker.
    const color = new Float32Array(faceGeometry.getAttribute('position').count * 3).fill(slots.secondFaceGain);
    faceGeometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    faceMaterial = new THREE.MeshStandardMaterial({ color: slots.brown, roughness: 1, vertexColors: true });
  }
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.name = `sheep-${variant + 1}-face`;
  face.position.set(...SHEEP_GEOMETRY.facePosition);
  head.add(face);
  const earGeometry = new THREE.BoxGeometry(...SHEEP_GEOMETRY.ear);
  for (const x of SHEEP_GEOMETRY.earXs) {
    const ear = new THREE.Mesh(earGeometry, detail);
    ear.name = `sheep-${variant + 1}-ear`;
    ear.position.set(x, SHEEP_GEOMETRY.earY, SHEEP_GEOMETRY.earZ);
    head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.BoxGeometry(...SHEEP_GEOMETRY.nose), detail);
  nose.name = `sheep-${variant + 1}-nose`;
  nose.position.set(...SHEEP_GEOMETRY.nosePosition);
  head.add(nose);

  let elapsed = 0;
  function update(deltaSeconds: number) {
    elapsed = (elapsed + deltaSeconds) % SHEEP_NOD_PERIOD;
    head.rotation.x = Math.sin(phase + elapsed / SHEEP_NOD_PERIOD * Math.PI * 2) * SHEEP_NOD_ANGLE;
  }
  update(0);
  return { group, update };
}
