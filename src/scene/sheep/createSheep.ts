import * as THREE from 'three';
import { FARM_PALETTE } from '../farmPalette';

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

  const wool = [woolMaterial(SHEEP_WOOL.shade), woolMaterial(SHEEP_WOOL.base), woolMaterial(SHEEP_WOOL.top)];
  const lobeGeometry = new THREE.IcosahedronGeometry(1, 1);
  // Distinct silhouettes, not merely a colour change. Feet overlap the lower
  // lobes; the raised middle lobe gives the wool a soft, chunky outline.
  const layouts = [
    [[0, 0.43, -0.20, 0.28, 0.275, 0.28], [-0.02, 0.51, 0, 0.29, 0.28, 0.28],
      [0, 0.43, 0.20, 0.28, 0.275, 0.28]],
    [[0.025, 0.44, -0.21, 0.27, 0.275, 0.28], [0.035, 0.50, -0.025, 0.285, 0.28, 0.28],
      [-0.025, 0.44, 0.20, 0.28, 0.27, 0.28]],
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
  const legGeometry = new THREE.BoxGeometry(0.12, 0.2, 0.12);
  for (const x of [-0.11, 0.11]) for (const z of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(legGeometry, brown);
    leg.name = `sheep-${variant + 1}-leg`;
    leg.position.set(x, 0.1, z);
    group.add(leg);
  }

  const head = new THREE.Group();
  head.name = `sheep-${variant + 1}-head-pivot`;
  head.position.set(0, 0.42, 0.34);
  group.add(head);
  const faceGeometry = new THREE.BoxGeometry(0.3, 0.3, 0.32);
  let faceMaterial = brown;
  if (variant === 1) {
    // Retain the trunk-brown token while shading the second face slightly darker.
    const color = new Float32Array(faceGeometry.getAttribute('position').count * 3).fill(0.86);
    faceGeometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    faceMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeTrunk, roughness: 1, vertexColors: true });
  }
  const face = new THREE.Mesh(faceGeometry, faceMaterial);
  face.name = `sheep-${variant + 1}-face`;
  face.position.set(0, -0.08, 0.14);
  head.add(face);
  const earGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.12);
  for (const x of [-0.2, 0.2]) {
    const ear = new THREE.Mesh(earGeometry, detail);
    ear.name = `sheep-${variant + 1}-ear`;
    ear.position.set(x, 0.01, 0.1);
    head.add(ear);
  }
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.1), detail);
  nose.name = `sheep-${variant + 1}-nose`;
  nose.position.set(0, -0.15, 0.34);
  head.add(nose);

  let elapsed = 0;
  function update(deltaSeconds: number) {
    elapsed = (elapsed + deltaSeconds) % SHEEP_NOD_PERIOD;
    head.rotation.x = Math.sin(phase + elapsed / SHEEP_NOD_PERIOD * Math.PI * 2) * SHEEP_NOD_ANGLE;
  }
  update(0);
  return { group, update };
}
