import * as THREE from 'three';
import { GROUND_HEIGHT, GROUND_SIZE } from './createIsland';
import type { FarmObstacle } from './farmCollisions';
import { boxPolygon, clipPolygon, polygonsOverlap, rectangle, subtractPolygon, type FarmPoint } from './farmFootprints';
import { WATER_FEATURE, type WaterFeatureSpec } from './waterFeatureSpec';

function polygonObstacle(name: string, points: FarmPoint[], blocksWalking = true): FarmObstacle {
  return {
    kind: 'polygon', name, points, blocksWalking,
    minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
    minZ: Math.min(...points.map((point) => point.z)), maxZ: Math.max(...points.map((point) => point.z)),
  };
}

function surface(parent: THREE.Group, name: string, points: readonly FarmPoint[], height: number, material: THREE.Material) {
  const positions = points.flatMap(({ x, z }) => [x, height, z]);
  const indices: number[] = [];
  for (let i = 1; i < points.length - 1; i++) indices.push(0, i + 1, i);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  parent.add(mesh);
}

/** Placeholder meshes and all walking/placement footprints come from one spec. */
export function createWaterFeature(
  parent: THREE.Group, pond: Extract<FarmObstacle, { kind: 'box' }>, spec: WaterFeatureSpec = WATER_FEATURE,
) {
  const { stream, bridge, waterfall, palette } = spec;
  const outlet = stream.points.at(-1);
  const half = GROUND_SIZE / 2;
  const directions = {
    east: { x: 1, z: 0 }, west: { x: -1, z: 0 },
    north: { x: 0, z: -1 }, south: { x: 0, z: 1 },
  };
  const direction = directions[waterfall.side];
  const fallWidth = waterfall.width ?? stream.width;
  if (!outlet || stream.points.length < 2 || stream.width <= 0 || bridge.length <= 0 || bridge.width <= 0 ||
      fallWidth <= 0 || waterfall.lipDepth <= 0 || waterfall.drop <= 0 ||
      Math.abs(outlet.x * direction.x + outlet.z * direction.z - half) > 1e-6 ||
      Math.abs(outlet.x * direction.z - outlet.z * direction.x) + fallWidth / 2 > half) {
    throw new Error('Water feature needs positive sizes and a waterfall outlet on the selected island edge');
  }

  const group = new THREE.Group();
  group.name = 'farm-water-feature';
  parent.add(group);
  const waterMaterial = new THREE.MeshStandardMaterial({ color: palette.stream, roughness: 0.25 });
  const woodMaterial = new THREE.MeshStandardMaterial({ color: palette.bridge, roughness: 1 });
  const fallMaterial = new THREE.MeshStandardMaterial({
    color: palette.waterfall, roughness: 0.25, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const island = rectangle(0, 0, GROUND_SIZE, GROUND_SIZE);
  const angle = bridge.rotationDegrees * Math.PI / 180;
  const deck = rectangle(bridge.x, bridge.z, bridge.length, bridge.width, angle);
  const walkingOpening = bridge.walkRule === 'walkable';
  const waterObstacles: FarmObstacle[] = [];

  function addWater(name: string, footprint: FarmPoint[]) {
    const clipped = clipPolygon(footprint, island);
    if (!clipped.length) return;
    surface(group, `farm-${name}`, clipped, GROUND_HEIGHT + stream.surfaceLift, waterMaterial);
    const pieces = walkingOpening ? subtractPolygon(clipped, deck) : [clipped];
    pieces.forEach((piece, index) => waterObstacles.push(polygonObstacle(`${name}-${index + 1}`, piece)));
  }

  for (let i = 0; i < stream.points.length - 1; i++) {
    const a = stream.points[i];
    const b = stream.points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length <= 1e-9) throw new Error('Water route must not have repeated consecutive points');
    addWater(`stream-segment-${i + 1}`, rectangle((a.x + b.x) / 2, (a.z + b.z) / 2, length, stream.width, -Math.atan2(dz, dx)));
  }
  // Rounded joins fill gaps between adjacent straight segments at bends.
  for (let i = 1; i < stream.points.length - 1; i++) {
    const { x, z } = stream.points[i];
    const points = Array.from({ length: 12 }, (_, index) => ({
      x: x + Math.cos(index * Math.PI / 6) * stream.width / 2,
      z: z + Math.sin(index * Math.PI / 6) * stream.width / 2,
    }));
    addWater(`stream-bend-${i}`, points);
  }

  addWater('waterfall-edge', rectangle(
    outlet.x - direction.x * waterfall.lipDepth / 2, outlet.z - direction.z * waterfall.lipDepth / 2,
    waterfall.lipDepth, fallWidth, -Math.atan2(direction.z, direction.x),
  ));
  const fall = new THREE.Mesh(new THREE.PlaneGeometry(fallWidth, waterfall.drop), fallMaterial);
  fall.name = 'farm-waterfall-face';
  fall.position.set(outlet.x, GROUND_HEIGHT + stream.surfaceLift - waterfall.drop / 2, outlet.z);
  fall.rotation.y = Math.atan2(direction.x, direction.z);
  group.add(fall);

  const deckMesh = new THREE.Mesh(new THREE.BoxGeometry(bridge.length, bridge.thickness, bridge.width), woodMaterial);
  deckMesh.name = 'farm-wooden-bridge';
  deckMesh.position.set(bridge.x, GROUND_HEIGHT + bridge.topLift - bridge.thickness / 2, bridge.z);
  deckMesh.rotation.y = angle;
  group.add(deckMesh);

  // The pond keeps its original box unless the walkable deck actually overlaps
  // it. No building, tree or other obstacle is ever cut by the bridge.
  const pondPolygon = boxPolygon(pond);
  const pondObstacles = walkingOpening && polygonsOverlap(pondPolygon, deck)
    ? subtractPolygon(pondPolygon, deck).map((piece, index) => polygonObstacle(`pond-${index + 1}`, piece))
    : [pond];
  return [
    ...pondObstacles,
    ...waterObstacles,
    // The same shared array feeds placement, so even a walkable deck reserves tiles.
    polygonObstacle('wooden-bridge', deck, !walkingOpening),
  ];
}
