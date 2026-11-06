import * as THREE from 'three';
import { GROUND_HEIGHT } from './createIsland';
import type { FarmObstacle } from './farmCollisions';
import { WATER_FEATURE } from './waterFeatureSpec';

function grade(localX: number) {
  const { bridge } = WATER_FEATURE;
  return bridge.topLift * Math.min(1, Math.max(0, (bridge.length / 2 - Math.abs(localX)) / bridge.gradeLength));
}

/** The visible profile and the character's lower capsule use the same grade. */
export function bridgeHeight(x: number, z: number, radius = 0): number | undefined {
  const { bridge } = WATER_FEATURE;
  const localX = x - bridge.x;
  const half = bridge.length / 2;
  const lateralGap = Math.max(0, Math.abs(z - bridge.z) - bridge.width / 2);
  if (radius <= 0) {
    return Math.abs(localX) <= half + 1e-9 && lateralGap <= 1e-9 ? GROUND_HEIGHT + grade(localX) : undefined;
  }
  if (lateralGap >= radius || Math.abs(localX) > half + radius) return undefined;
  const reach = Math.sqrt(radius * radius - lateralGap * lateralGap);
  const points = [-half, -half + bridge.gradeLength, half - bridge.gradeLength, half];
  let lift = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const min = Math.max(points[i], localX - reach);
    const max = Math.min(points[i + 1], localX + reach);
    if (min > max) continue;
    const slope = (grade(points[i + 1]) - grade(points[i])) / (points[i + 1] - points[i]);
    const tangent = localX + slope * reach / Math.sqrt(1 + slope * slope);
    for (const sample of [min, max, THREE.MathUtils.clamp(tangent, min, max)]) {
      const dx = sample - localX;
      const contact = grade(sample) - radius + Math.sqrt(Math.max(0, reach * reach - dx * dx));
      lift = Math.max(lift, contact);
    }
  }
  return lift > 1e-9 ? GROUND_HEIGHT + lift : undefined;
}

export function createWoodenBridge(parent: THREE.Group): Extract<FarmObstacle, { kind: 'box' }> {
  const { bridge, palette } = WATER_FEATURE;
  const half = bridge.length / 2;
  const group = new THREE.Group();
  group.name = 'farm-wooden-bridge';
  group.position.set(bridge.x, GROUND_HEIGHT, bridge.z);
  parent.add(group);
  const plank = new THREE.MeshStandardMaterial({ color: palette.plank, roughness: 1 });
  const gap = new THREE.MeshStandardMaterial({ color: palette.gap, roughness: 1 });
  const rail = new THREE.MeshStandardMaterial({ color: palette.rail, roughness: 1 });

  // Extruding the actual grade avoids invisible steps at either end. The gaps
  // are dark lines on five 0.4-wide boards, not a different bridge footprint.
  function gradedPiece(name: string, start: number, end: number, z: number, depth: number,
    thickness: number, lift: number, material: THREE.Material) {
    const breaks = [start, -half + bridge.gradeLength, half - bridge.gradeLength, end]
      .filter((x) => x >= start && x <= end).sort((a, b) => a - b);
    const shape = new THREE.Shape();
    shape.moveTo(breaks[0], grade(breaks[0]) + lift - thickness);
    for (const x of breaks) shape.lineTo(x, grade(x) + lift);
    for (const x of [...breaks].reverse()) shape.lineTo(x, grade(x) + lift - thickness);
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), material);
    mesh.name = name;
    mesh.position.z = z;
    group.add(mesh);
    return mesh;
  }

  gradedPiece('bridge-underside', -half, half, -bridge.width / 2, bridge.width, 0.06, -0.01, gap);
  const plankLength = bridge.length / bridge.plankCount;
  for (let i = 0; i < bridge.plankCount; i++) {
    const start = -half + i * plankLength;
    gradedPiece(`bridge-plank-${i + 1}`, start, start + plankLength, -bridge.width / 2, bridge.width, 0.04, 0, plank);
    if (i > 0) {
      gradedPiece(`bridge-gap-${i}`, start - bridge.gapWidth / 2, start + bridge.gapWidth / 2,
        -bridge.width / 2, bridge.width, 0.002, 0.001, gap);
    }
  }

  for (const side of [-1, 1]) {
    const z = side * (bridge.width / 2 - bridge.postSize / 2);
    gradedPiece(`bridge-rail-${side < 0 ? 'north' : 'south'}`, -half, half, z - bridge.postSize / 2,
      bridge.postSize, bridge.postSize, bridge.railHeight, rail);
    for (const [index, x] of [-half + bridge.postSize / 2, 0, half - bridge.postSize / 2].entries()) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(bridge.postSize, bridge.railHeight, bridge.postSize), rail);
      post.name = `bridge-post-${side < 0 ? 'north' : 'south'}-${index + 1}`;
      post.position.set(x, grade(x) + bridge.railHeight / 2, z);
      group.add(post);
    }
  }

  return {
    kind: 'box', name: 'wooden-bridge', blocksWalking: bridge.walkRule !== 'walkable',
    minX: bridge.x - half, maxX: bridge.x + half,
    minZ: bridge.z - bridge.width / 2, maxZ: bridge.z + bridge.width / 2,
  };
}
