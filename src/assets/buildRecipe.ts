import * as THREE from 'three';
import { ASSET_PALETTE } from './palette';
import type { AssetPart, AssetRecipe, Vec3 } from './types';

// A single vertex at an axis endpoint avoids the zero-area pole triangles
// produced by some stock cone/lathe tessellations.
function lathe(profile: [number, number][], segments: number) {
  const vertices: number[] = [];
  const rings: number[][] = [];
  for (const [radius, y] of profile) {
    const ring: number[] = [];
    const count = radius < 1e-8 ? 1 : segments;
    for (let i = 0; i < count; i++) {
      const angle = i * Math.PI * 2 / segments;
      ring.push(vertices.length / 3);
      vertices.push(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    }
    rings.push(ring);
  }
  const indices: number[] = [];
  for (let row = 0; row < rings.length - 1; row++) {
    const bottom = rings[row], top = rings[row + 1];
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      if (bottom.length === 1 && top.length > 1) indices.push(bottom[0], top[next], top[i]);
      else if (top.length === 1 && bottom.length > 1) indices.push(bottom[i], bottom[next], top[0]);
      else if (bottom.length > 1 && top.length > 1) {
        indices.push(bottom[i], bottom[next], top[i], bottom[next], top[next], top[i]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function capsule(radius: number, length: number, segments: number) {
  const profile: [number, number][] = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / (2 * steps);
    profile.push([radius * Math.cos(angle), -length / 2 + radius * Math.sin(angle)]);
  }
  for (let i = 0; i <= steps; i++) {
    const angle = i * Math.PI / (2 * steps);
    profile.push([radius * Math.cos(angle), length / 2 + radius * Math.sin(angle)]);
  }
  return lathe(profile, segments);
}

function geometryFor(part: AssetPart): THREE.BufferGeometry {
  switch (part.prim) {
    case 'box': return new THREE.BoxGeometry(...part.size);
    case 'cylinder': return new THREE.CylinderGeometry(part.radiusTop, part.radiusBottom, part.h, part.segments);
    case 'cone': return lathe([[0, -part.h / 2], [part.radius, -part.h / 2], [0, part.h / 2]], part.segments);
    case 'sphere': return new THREE.IcosahedronGeometry(part.radius, part.detail);
    case 'capsule': return capsule(part.radius, part.length, part.segments);
    case 'lathe': return lathe(part.profile, part.segments);
    case 'wedge': {
      const [width, height, depth] = part.size;
      const shape = new THREE.Shape();
      shape.moveTo(-depth / 2, -height / 2);
      shape.lineTo(depth / 2, -height / 2);
      shape.lineTo(-depth / 2, height / 2);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
      geometry.rotateY(Math.PI / 2);
      geometry.translate(-width / 2, 0, 0);
      return geometry;
    }
    case 'extrude': {
      const shape = new THREE.Shape();
      part.polygon.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y));
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: part.depth, bevelEnabled: false, curveSegments: 1 });
      geometry.translate(0, 0, -part.depth / 2);
      return geometry;
    }
    case 'custom': {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
      geometry.setIndex(part.indices);
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}

function seededOffsets(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296 * 2 - 1;
  };
}

function vectorWithJitter(value: Vec3, amount: number, random: () => number): Vec3 {
  return [value[0] + amount * random(), value[1] + amount * random(), value[2] + amount * random()];
}

/** Build a validated recipe. No code, lights, textures or I/O come from it. */
export function buildRecipe(recipe: AssetRecipe): THREE.Group {
  const group = new THREE.Group();
  group.name = recipe.id;
  group.userData.recipeId = recipe.id;
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  for (const part of recipe.parts) {
    const token = recipe.slots[part.mat] ?? part.mat;
    const color = (ASSET_PALETTE as Record<string, number>)[token];
    if (color === undefined) throw new Error(`Unknown or unapproved palette token: ${token}`);
    const materialKey = `${token}:${!!part.polygonOffset}`;
    let material = materials.get(materialKey);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: token.startsWith('water') || token === 'glass' ? 0.4 : 1,
        metalness: 0, polygonOffset: !!part.polygonOffset, polygonOffsetFactor: part.polygonOffset ? -1 : 0,
        polygonOffsetUnits: part.polygonOffset ? -1 : 0 });
      materials.set(materialKey, material);
    }
    const mesh = new THREE.Mesh(geometryFor(part), material);
    mesh.name = part.name;
    mesh.userData.feature = part.feature ?? null;
    mesh.userData.primitive = part.prim;
    mesh.userData.exception = part.exception ?? null;
    const random = seededOffsets(part.seed ?? 0);
    const position = vectorWithJitter(part.at, part.jitter?.position ?? 0, random);
    const baseRotation = (part.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as Vec3;
    const rotation = vectorWithJitter(baseRotation, part.jitter?.rotation ?? 0, random);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...(part.scale ?? [1, 1, 1]));
    group.add(mesh);
  }
  for (const accent of recipe.emissive) {
    const mesh = group.getObjectByName(accent.part) as THREE.Mesh | undefined;
    const token = recipe.slots[accent.mat] ?? accent.mat;
    const color = (ASSET_PALETTE as Record<string, number>)[token];
    if (!mesh || color === undefined) throw new Error(`Invalid emissive accent: ${accent.part}/${token}`);
    // A per-mesh material avoids changing other parts that share a token.
    mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
    (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(color);
    (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0;
    mesh.userData.nightStrength = accent.strength;
  }
  return group;
}

/** Set declared material glow only; this never creates a light. */
export function setRecipeNightAmount(group: THREE.Group, amount: number) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new RangeError('Night amount must be 0..1');
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && typeof object.userData.nightStrength === 'number') {
      (object.material as THREE.MeshStandardMaterial).emissiveIntensity = object.userData.nightStrength * amount;
    }
  });
}
