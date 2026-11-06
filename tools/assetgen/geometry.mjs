import * as THREE from 'three';

const finite = (value) => Number.isFinite(value);
const rgb = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const hexString = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const distance = (a, b) => Math.hypot(...rgb(a).map((value, index) => value - rgb(b)[index]));
const round = (value) => Math.round(value * 10000) / 10000;

// Convex triangle intersection in a common 2D projection. Edge contact alone
// has zero area and is not a z-fight. Unlike bounding-box-only checks this also
// catches partial overlaps and differently triangulated quads.
function intersectionArea(a, b) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const sign = Math.sign(cross(b[0], b[1], b[2]));
  if (!sign) return 0;
  let polygon = a;
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const p = b[edge];
    const q = b[(edge + 1) % 3];
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const from = polygon[i];
      const to = polygon[(i + 1) % polygon.length];
      const f = sign * cross(p, q, from);
      const t = sign * cross(p, q, to);
      const fromInside = f >= -1e-10;
      const toInside = t >= -1e-10;
      if (fromInside) output.push(from);
      if (fromInside !== toInside) {
        const ratio = f / (f - t);
        output.push([from[0] + ratio * (to[0] - from[0]), from[1] + ratio * (to[1] - from[1])]);
      }
    }
    polygon = output;
  }
  if (polygon.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i];
    const q = polygon[(i + 1) % polygon.length];
    area += p[0] * q[1] - p[1] * q[0];
  }
  return Math.abs(area) / 2;
}

function coplanarOverlaps(triangles, rules) {
  let count = 0;
  const examples = [];
  for (let i = 0; i < triangles.length; i++) {
    const a = triangles[i];
    for (let j = i + 1; j < triangles.length; j++) {
      const b = triangles[j];
      if (Math.abs(a.normal.dot(b.normal)) < rules.zFightNormalDot) continue;
      if (Math.abs(a.normal.dot(b.points[0]) - a.plane) > rules.zFightPlaneDistance) continue;
      if (!a.box.clone().expandByScalar(rules.zFightPlaneDistance).intersectsBox(b.box)) continue;
      const n = a.normal;
      const drop = Math.abs(n.x) >= Math.abs(n.y) && Math.abs(n.x) >= Math.abs(n.z) ? 'x'
        : Math.abs(n.y) >= Math.abs(n.z) ? 'y' : 'z';
      const project = (point) => drop === 'x' ? [point.y, point.z] : drop === 'y' ? [point.x, point.z] : [point.x, point.y];
      if (intersectionArea(a.points.map(project), b.points.map(project)) > rules.zFightOverlapArea) {
        count++;
        if (examples.length < 8) examples.push(`${a.name}[${a.index}] / ${b.name}[${b.index}]`);
      }
    }
  }
  return { count, examples };
}

/** Inspect an already-built group. This deliberately has no browser dependency. */
export function inspectGeometry(module, spec, rules, palette, references = {}) {
  const failures = [];
  const fail = (code, message) => {
    if (!failures.some((item) => item.code === code && item.message === message)) failures.push({ code, message });
  };
  const meta = module?.meta;
  if (!meta || typeof meta !== 'object') return { failures: [{ code: 'META', message: 'Missing meta export' }], metrics: {} };
  if (meta.id !== spec.id || meta.category !== spec.category) fail('META', 'meta id and category must match the spec');
  const declared = [meta.footprint?.width, meta.footprint?.depth, meta.height];
  const targets = [spec.size.width, spec.size.depth, spec.size.height];
  if (declared.some((number, index) => !finite(number) || Math.abs(number - targets[index]) > 1e-6)) {
    fail('META', 'meta footprint and height must equal the spec size targets');
  }
  const maxBudget = rules.triBudgets[spec.category];
  if (!Number.isInteger(meta.triBudget) || meta.triBudget < 1 || meta.triBudget > maxBudget) {
    fail('META', `triBudget must be an integer from 1 to ${maxBudget}`);
  }
  const declaredPalette = Array.isArray(meta.palette) ? meta.palette : [];
  if (!declaredPalette.length || declaredPalette.some((key) => !Object.hasOwn(palette, key))) {
    fail('META_PALETTE', 'meta.palette must list qualified, existing farm.* or building.* keys');
  }

  let group;
  try {
    group = module.build();
  } catch (error) {
    return { failures: [...failures, { code: 'BUILD', message: String(error?.stack || error) }], metrics: {} };
  }
  if (!(group instanceof THREE.Group)) {
    return { failures: [...failures, { code: 'BUILD', message: 'build() must return a THREE.Group' }], metrics: {} };
  }
  if (group.position.length() > 1e-8 || group.rotation.toVector3().length() > 1e-8 || group.scale.distanceTo(new THREE.Vector3(1, 1, 1)) > 1e-8) {
    fail('ORIGIN', 'The returned group must have an identity transform');
  }
  group.updateMatrixWorld(true);
  const colors = new Map();
  const paletteValues = Object.entries(palette);
  const triangles = [];
  const bounds = new THREE.Box3();
  let triangleCount = 0;
  let meshCount = 0;
  let badNormalCount = 0;
  let degenerateCount = 0;
  let nonFiniteCount = 0;
  let badIndexCount = 0;

  function checkColor(color) {
    const hex = color.getHex();
    if (colors.has(hex)) return;
    let nearest = null;
    for (const [key, value] of paletteValues) {
      const delta = distance(hex, value);
      if (!nearest || delta < nearest.distance) nearest = { key, distance: delta };
    }
    colors.set(hex, nearest);
    if (!nearest || nearest.distance > rules.paletteDistanceRGB) {
      fail('OFF_PALETTE', `${hexString(hex)} is ${round(nearest?.distance ?? Infinity)} RGB units from ${nearest?.key ?? 'the palette'}`);
    }
    if (!declaredPalette.some((key) => Object.hasOwn(palette, key) && distance(hex, palette[key]) <= rules.paletteDistanceRGB)) {
      fail('META_PALETTE', `${hexString(hex)} is not represented in meta.palette`);
    }
  }

  group.traverse((object) => {
    if (![...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray(), ...object.matrixWorld.elements].every(finite)) {
      nonFiniteCount++;
    }
    if (object.isLight || object.isSprite || object.isPoints || object.isLine || object.isInstancedMesh || object.isSkinnedMesh) {
      fail('UNSUPPORTED_OBJECT', `${object.name || object.type}: only ordinary meshes and groups are allowed`);
    }
    if (!object.isMesh) return;
    meshCount++;
    if (!object.visible) fail('UNSUPPORTED_OBJECT', `${object.name || object.type}: hidden meshes are not allowed`);
    const geometry = object.geometry;
    const position = geometry?.getAttribute?.('position');
    const normal = geometry?.getAttribute?.('normal');
    const vertexColor = geometry?.getAttribute?.('color');
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (!position || position.itemSize < 3 || !normal || normal.itemSize < 3 || normal.count !== position.count) {
      fail('NORMALS', `${object.name || 'mesh'} needs a position and one normal per vertex`);
      return;
    }
    for (const material of materials) {
      if (!material?.isMeshStandardMaterial || !material.flatShading || material.transparent || material.opacity !== 1 ||
          material.wireframe || !material.depthWrite || !material.colorWrite || material.polygonOffset || material.side !== THREE.FrontSide) {
        fail('MATERIAL', `${object.name || 'mesh'} must use opaque, front-sided, flat-shaded MeshStandardMaterial without polygon offset`);
        continue;
      }
      if (Object.values(material).some((value) => value?.isTexture)) fail('TEXTURE', `${object.name || 'mesh'} uses a texture`);
      if (material.emissive && material.emissiveIntensity > 0 && material.emissive.getHex() !== 0) {
        fail('MATERIAL', `${object.name || 'mesh'} uses emissive colour`);
      }
      if (material.vertexColors) {
        if (!vertexColor || vertexColor.count !== position.count || vertexColor.itemSize < 3) {
          fail('MATERIAL', `${object.name || 'mesh'} has vertexColors but no RGB colour per vertex`);
        } else {
          for (let i = 0; i < vertexColor.count; i++) {
            const components = [vertexColor.getX(i), vertexColor.getY(i), vertexColor.getZ(i)];
            if (!components.every(finite)) { nonFiniteCount++; continue; }
            checkColor(material.color.clone().multiply(new THREE.Color().setRGB(...components)));
          }
        }
      } else {
        if (![material.color.r, material.color.g, material.color.b].every(finite)) nonFiniteCount++;
        else checkColor(material.color);
      }
    }
    const vertices = [];
    const normals = [];
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i);
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      if (![...point.toArray(), ...n.toArray()].every(finite)) {
        nonFiniteCount++;
        vertices.push(null);
        normals.push(null);
        continue;
      }
      if (n.length() < 0.8 || n.length() > 1.2) badNormalCount++;
      point.applyMatrix4(object.matrixWorld);
      n.applyNormalMatrix(normalMatrix);
      if (![...point.toArray(), ...n.toArray()].every(finite)) { nonFiniteCount++; vertices.push(null); normals.push(null); continue; }
      vertices.push(point);
      normals.push(n);
      bounds.expandByPoint(point);
    }
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    if (count % 3 !== 0) fail('GEOMETRY', `${object.name || 'mesh'} triangle index count is not divisible by three`);
    triangleCount += Math.floor(count / 3);
    for (let i = 0; i + 2 < count; i += 3) {
      const indices = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset);
      if (indices.some((value) => !Number.isInteger(value) || value < 0 || value >= position.count)) { badIndexCount++; continue; }
      const points = indices.map((value) => vertices[value]);
      const ns = indices.map((value) => normals[value]);
      if (points.some((point) => !point) || ns.some((n) => !n)) continue;
      const face = new THREE.Vector3().subVectors(points[1], points[0]).cross(new THREE.Vector3().subVectors(points[2], points[0]));
      if (face.length() / 2 <= rules.degenerateArea) { degenerateCount++; continue; }
      face.normalize();
      if (ns[0].clone().add(ns[1]).add(ns[2]).dot(face) <= 0) badNormalCount++;
      triangles.push({ points, normal: face, plane: face.dot(points[0]), box: new THREE.Box3().setFromPoints(points),
        name: object.name || `mesh-${meshCount}`, index: i / 3 });
    }
  });

  if (!meshCount || bounds.isEmpty()) fail('BUILD', 'Asset has no finite mesh geometry');
  if (nonFiniteCount) fail('NON_FINITE', `${nonFiniteCount} non-finite vertex, normal, colour or transform values`);
  if (badIndexCount) fail('GEOMETRY', `${badIndexCount} triangles have invalid indices`);
  if (badNormalCount) fail('NORMALS', `${badNormalCount} normals are non-unit, zero or face backwards`);
  if (degenerateCount) fail('DEGENERATE', `${degenerateCount} zero-area triangles`);
  if (triangleCount > meta.triBudget) fail('TRI_BUDGET', `${triangleCount} triangles exceeds declared budget ${meta.triBudget}`);
  if (colors.size > rules.maxColors) fail('COLOR_COUNT', `${colors.size} colours exceeds maximum ${rules.maxColors}`);

  let size = new THREE.Vector3();
  let center = new THREE.Vector3();
  if (!bounds.isEmpty()) {
    size = bounds.getSize(new THREE.Vector3());
    center = bounds.getCenter(new THREE.Vector3());
    for (const [index, dimension] of ['width', 'depth', 'height'].entries()) {
      const actual = [size.x, size.z, size.y][index];
      const target = targets[index];
      const tolerance = Math.max(rules.dimensionToleranceAbsolute, target * rules.dimensionToleranceRelative);
      if (actual > target + tolerance || actual < target * rules.minimumBoundsFraction - rules.dimensionToleranceAbsolute) {
        fail('BOUNDS', `${dimension} ${round(actual)} is outside target ${target} (+${round(tolerance)}, minimum ${round(target * rules.minimumBoundsFraction - rules.dimensionToleranceAbsolute)})`);
      }
    }
    for (const axis of ['x', 'z']) {
      const target = axis === 'x' ? targets[0] : targets[1];
      const tolerance = Math.max(rules.centerToleranceAbsolute, target * rules.centerToleranceRelative);
      if (Math.abs(center[axis]) > tolerance) fail('ORIGIN', `${axis} bounds centre ${round(center[axis])} exceeds tolerance ${round(tolerance)}`);
    }
    if (bounds.min.y < -rules.belowGroundTolerance) fail('BELOW_GROUND', `lowest y ${round(bounds.min.y)} is below -${rules.belowGroundTolerance}`);
    if (bounds.min.y > rules.belowGroundTolerance) fail('ORIGIN', `lowest y ${round(bounds.min.y)} does not touch the base`);
  }
  const zFight = coplanarOverlaps(triangles, rules);
  if (zFight.count) fail('Z_FIGHT', `${zFight.count} near-coplanar overlapping triangle pairs: ${zFight.examples.join(', ')}`);

  const ratioRule = rules.referenceHeightRatios[spec.category];
  let referenceRatio = null;
  if (ratioRule && finite(references[ratioRule.reference]) && references[ratioRule.reference] > 0) {
    referenceRatio = size.y / references[ratioRule.reference];
    if (referenceRatio < ratioRule.min || referenceRatio > ratioRule.max) {
      fail('REFERENCE_SCALE', `height/reference ${ratioRule.reference} is ${round(referenceRatio)}; expected ${ratioRule.min}..${ratioRule.max}`);
    }
  } else if (ratioRule) {
    fail('REFERENCE_SCALE', `Missing signed ${ratioRule.reference} reference`);
  }
  return {
    failures,
    metrics: {
      triangles: triangleCount, triangleBudget: meta.triBudget, meshCount,
      bounds: bounds.isEmpty() ? null : { min: bounds.min.toArray().map(round), max: bounds.max.toArray().map(round),
        width: round(size.x), depth: round(size.z), height: round(size.y), centerXZ: [round(center.x), round(center.z)] },
      colors: [...colors].map(([hex, closest]) => ({ hex: hexString(hex), closest: closest?.key, distance: round(closest?.distance ?? Infinity) })),
      colorCount: colors.size, nonFiniteCount, degenerateCount, badNormalCount, zFightPairs: zFight.count,
      referenceHeights: references, reference: ratioRule?.reference, referenceRatio: referenceRatio === null ? null : round(referenceRatio),
    },
  };
}
