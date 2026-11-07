import * as THREE from 'three';
import { FARM_PALETTE } from '../../content/slots';

// The two existing chicken feather colours flank Look Dev's approved wool base.
export const SHEEP_WOOL = { top: 0xfff1d7, base: FARM_PALETTE.wool, shade: 0xe4d1ae } as const;
export const SHEEP_NOD_PERIOD = 4;
export const SHEEP_NOD_ANGLE = THREE.MathUtils.degToRad(12);

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
export function createSheep(variant: 0 | 1, phase: number) {
  const group = new THREE.Group();
  group.name = `sheep-${variant + 1}`;
  // Slightly turn the local +Z front so the elongated profile survives the
  // isometric pixel pass while remaining within the approved facing range.
  group.rotation.y = THREE.MathUtils.degToRad(variant === 0 ? -20 : -25);

  const wool = [woolMaterial(SHEEP_WOOL.shade), woolMaterial(SHEEP_WOOL.base), woolMaterial(SHEEP_WOOL.top)];
  const lobeGeometry = new THREE.IcosahedronGeometry(1, 1);
  // Three low-poly lobes form a long, shallow fleece above the visible legs.
  // Their offsets differ between the animals without recolouring the wool.
  const layouts = [
    [[0, 0.48, -0.165, 0.28, 0.27, 0.28], [-0.005, 0.49, 0, 0.29, 0.27, 0.28],
      [0, 0.48, 0.165, 0.28, 0.27, 0.28]],
    [[-0.015, 0.48, -0.17, 0.275, 0.27, 0.275], [0.01, 0.49, -0.02, 0.285, 0.27, 0.28],
      [0.005, 0.48, 0.17, 0.28, 0.27, 0.275]],
  ];
  layouts[variant].forEach(([x, y, z, sx, sy, sz], index) => {
    const lobe = new THREE.Mesh(lobeGeometry, wool[index]);
    lobe.name = `sheep-${variant + 1}-wool-${index + 1}`;
    lobe.position.set(x, y, z);
    lobe.scale.set(sx, sy, sz);
    group.add(lobe);
  });

  const brown = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeTrunk, roughness: 1 });
  const detail = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirtEdge, roughness: 1 });
  const legGeometry = new THREE.BoxGeometry(0.24, 0.32, 0.24);
  for (const x of [-0.16, 0.16]) for (const z of [-0.22, 0.22]) {
    const leg = new THREE.Mesh(legGeometry, brown);
    leg.name = `sheep-${variant + 1}-leg`;
    // Stagger the second sheep's near rear leg slightly so it remains visible
    // behind the unchanged fence at the 320×180 game resolution.
    leg.position.set(x, 0.16, variant === 1 && x > 0 && z < 0 ? -0.14 : z);
    group.add(leg);
  }

  const head = new THREE.Group();
  head.name = `sheep-${variant + 1}-head-pivot`;
  head.position.set(0, 0.54, 0.4);
  group.add(head);
  const faceGeometry = new THREE.BoxGeometry(0.36, 0.32, 0.36);
  let faceMaterial = brown;
  if (variant === 1) {
    // Retain the trunk-brown token while shading the second face slightly darker.
    const color = new Float32Array(faceGeometry.getAttribute('position').count * 3).fill(0.86);
    faceGeometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    faceMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeTrunk, roughness: 1, vertexColors: true });
  }
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.name = `sheep-${variant + 1}-face`;
  face.position.set(0, -0.055, 0.2);
  head.add(face);
  const earGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.14);
  for (const x of [-0.23, 0.23]) {
    const ear = new THREE.Mesh(earGeometry, detail);
    ear.name = `sheep-${variant + 1}-ear`;
    ear.position.set(x, 0.015, 0.15);
    head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.1), detail);
  nose.name = `sheep-${variant + 1}-nose`;
  nose.position.set(0, -0.13, 0.43);
  head.add(nose);

  let elapsed = 0;
  function update(deltaSeconds: number) {
    elapsed = (elapsed + deltaSeconds) % SHEEP_NOD_PERIOD;
    head.rotation.x = Math.sin(phase + elapsed / SHEEP_NOD_PERIOD * Math.PI * 2) * SHEEP_NOD_ANGLE;
  }
  update(0);
  return { group, update };
}
