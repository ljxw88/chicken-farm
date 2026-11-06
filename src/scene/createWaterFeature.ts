import * as THREE from 'three';
import { GROUND_HEIGHT, GROUND_SIZE } from './createIsland';
import type { FarmObstacle } from './farmCollisions';
import { createWaterfall } from './createWaterfall';
import { bridgeHeight, createWoodenBridge } from './createWoodenBridge';
import { WATER_FEATURE } from './waterFeatureSpec';

type Box = Extract<FarmObstacle, { kind: 'box' }>;

/** Cut only stream boxes, never the unchanged pond/building/tree collisions. */
function cutBox(box: Box, opening: Box): Box[] {
  const minX = Math.max(box.minX, opening.minX);
  const maxX = Math.min(box.maxX, opening.maxX);
  const minZ = Math.max(box.minZ, opening.minZ);
  const maxZ = Math.min(box.maxZ, opening.maxZ);
  if (minX >= maxX || minZ >= maxZ) return [box];
  return [
    { ...box, maxX: minX }, { ...box, minX: maxX },
    { ...box, minX, maxX, maxZ: minZ }, { ...box, minX, maxX, minZ: maxZ },
  ].filter((piece) => piece.maxX - piece.minX > 1e-8 && piece.maxZ - piece.minZ > 1e-8);
}

export function createWaterFeature(parent: THREE.Group) {
  const { stream, bridge, palette } = WATER_FEATURE;
  const curve = new THREE.CatmullRomCurve3(stream.points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const group = new THREE.Group();
  group.name = 'farm-water-feature';
  parent.add(group);
  const segments = 200;
  const half = GROUND_SIZE / 2;

  function ribbon(name: string, width: number, lift: number, color: number, wobble = 0) {
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const centerOffset = Math.sin(t * Math.PI * 6) * wobble;
      for (const side of [1, -1]) {
        const offset = centerOffset + side * width / 2;
        vertices.push(
          THREE.MathUtils.clamp(point.x - tangent.z * offset, -half, half), GROUND_HEIGHT + lift,
          THREE.MathUtils.clamp(point.z + tangent.x * offset, -half, half),
        );
      }
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.25 }));
    mesh.name = name;
    group.add(mesh);
  }

  ribbon('farm-stream-rim', stream.rimWidth, stream.rimLift, palette.rim);
  ribbon('farm-stream-water', stream.width, stream.waterLift, palette.water);
  ribbon('farm-stream-deep', stream.deepWidth, stream.deepLift, palette.deep, 0.08);

  const foamMaterial = new THREE.MeshStandardMaterial({ color: palette.foam, roughness: 0.25 });
  const length = curve.getLength();
  for (let distance = stream.foamSpacing / 2, index = 0; distance < length - stream.foamLength; distance += stream.foamSpacing, index++) {
    const t = distance / length;
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const offset = (index % 2 === 0 ? 1 : -1) * stream.width * 0.3;
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(stream.foamLength, stream.foamWidth), foamMaterial);
    foam.name = `farm-stream-foam-${index + 1}`;
    foam.rotation.x = -Math.PI / 2;
    foam.rotateZ(-Math.atan2(tangent.z, tangent.x));
    foam.position.set(point.x - tangent.z * offset, GROUND_HEIGHT + stream.foamLift, point.z + tangent.x * offset);
    group.add(foam);
  }

  const deck = createWoodenBridge(group);
  const updateWaterfall = createWaterfall(group);
  const water: Box[] = [];
  const count = Math.ceil(length / stream.collisionLength);
  function addCollision(start: number, end: number) {
    const a = curve.getPointAt(start);
    const middle = curve.getPointAt((start + end) / 2);
    const b = curve.getPointAt(end);
    const minX = Math.min(a.x, middle.x, b.x);
    const maxX = Math.max(a.x, middle.x, b.x);
    // Two overlapping boxes cover a curved segment without widening the
    // locked 0.63 half-width of either source box.
    for (const x of maxX - minX < 1e-9 ? [minX] : [minX, maxX]) {
      water.push({
        kind: 'box', name: `stream-water-${water.length + 1}`,
        minX: x - stream.collisionHalfWidth, maxX: x + stream.collisionHalfWidth,
        minZ: Math.max(-half, Math.min(a.z, middle.z, b.z) - stream.collisionOverlap),
        maxZ: Math.min(half, Math.max(a.z, middle.z, b.z) + stream.collisionOverlap),
      });
    }
  }
  for (let i = 0; i < count; i++) {
    const start = i / count;
    const end = (i + 1) / count;
    const a = curve.getPointAt(start);
    const b = curve.getPointAt(end);
    // Engineer: refine the curved bridge approaches so an axis-aligned box
    // cannot project a phantom wall into the path; elsewhere boxes are ~1 long.
    const divisions = b.z >= deck.minZ - 1 && a.z <= deck.maxZ + 1 ? 4 : 1;
    for (let part = 0; part < divisions; part++) {
      addCollision(THREE.MathUtils.lerp(start, end, part / divisions), THREE.MathUtils.lerp(start, end, (part + 1) / divisions));
    }
  }
  const walkingWater = bridge.walkRule === 'walkable' ? water.flatMap((box) => cutBox(box, deck)) : water;
  return {
    curve, bridgeHeight,
    obstacles: [...walkingWater, deck],
    // Use the uncut water and complete deck so rain never splashes on either.
    splashExclusions: [...water, deck],
    updateWaterfall,
  };
}
