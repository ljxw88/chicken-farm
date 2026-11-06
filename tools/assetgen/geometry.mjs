import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { validateRecipe } from './schema.mjs';

const round = (number) => Math.round(number * 10000) / 10000;
const finite = (values) => values.every(Number.isFinite);

// Clip one projected triangle against another. Edge-only contact has zero area.
export function triangleIntersectionArea(a, b) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const sign = Math.sign(cross(b[0], b[1], b[2]));
  if (!sign) return 0;
  let polygon = a;
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const p = b[edge], q = b[(edge + 1) % 3];
    const output = [];
    for (let i = 0; i < polygon.length; i++) {
      const from = polygon[i], to = polygon[(i + 1) % polygon.length];
      const f = sign * cross(p, q, from), t = sign * cross(p, q, to);
      const insideFrom = f >= -1e-10, insideTo = t >= -1e-10;
      if (insideFrom) output.push(from);
      if (insideFrom !== insideTo) {
        const ratio = f / (f - t);
        output.push([from[0] + ratio * (to[0] - from[0]), from[1] + ratio * (to[1] - from[1])]);
      }
    }
    polygon = output;
  }
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    area += p[0] * q[1] - p[1] * q[0];
  }
  return Math.abs(area) / 2;
}

function project(normal, point) {
  if (Math.abs(normal.x) >= Math.abs(normal.y) && Math.abs(normal.x) >= Math.abs(normal.z)) return [point.y, point.z];
  return Math.abs(normal.y) >= Math.abs(normal.z) ? [point.x, point.z] : [point.x, point.y];
}

function coplanarOverlaps(triangles, rules) {
  let count = 0;
  const examples = [];
  for (let i = 0; i < triangles.length; i++) {
    const a = triangles[i];
    for (let j = i + 1; j < triangles.length; j++) {
      const b = triangles[j];
      if (a.offset || b.offset || Math.abs(a.normal.dot(b.normal)) < rules.zFightNormalDot) continue;
      if (b.points.some((point) => Math.abs(a.normal.dot(point) - a.plane) > rules.zFightPlaneDistance)) continue;
      if (!a.box.clone().expandByScalar(rules.zFightPlaneDistance).intersectsBox(b.box)) continue;
      if (triangleIntersectionArea(a.points.map((p) => project(a.normal, p)), b.points.map((p) => project(a.normal, p))) > rules.zFightOverlapArea) {
        count++;
        if (examples.length < 8) examples.push(`${a.name}[${a.index}]/${b.name}[${b.index}]`);
      }
    }
  }
  return { count, examples };
}

function pointInside(point, triangles, tolerance) {
  const ray = new THREE.Ray(point, new THREE.Vector3(0.819, 0.337, 0.465).normalize());
  const target = new THREE.Vector3();
  const hits = [];
  for (const triangle of triangles) {
    const hit = ray.intersectTriangle(...triangle.points, false, target);
    if (hit) {
      const distance = hit.distanceTo(point);
      if (distance > tolerance && !hits.some((previous) => Math.abs(previous - distance) < 1e-6)) hits.push(distance);
    }
  }
  return hits.length % 2 === 1;
}

function edgesIntersect(a, b, tolerance) {
  const ray = new THREE.Ray();
  const direction = new THREE.Vector3(), target = new THREE.Vector3();
  for (let i = 0; i < 3; i++) {
    const start = a.points[i], end = a.points[(i + 1) % 3];
    direction.subVectors(end, start);
    const length = direction.length();
    ray.set(start, direction.normalize());
    const hit = ray.intersectTriangle(...b.points, false, target);
    if (hit && hit.distanceTo(start) <= length + tolerance) return true;
  }
  return false;
}

function surfacesTouch(a, b, tolerance) {
  if (!a.box.clone().expandByScalar(tolerance).intersectsBox(b.box)) return false;
  if (a.triangles.length && b.triangles.length &&
      (pointInside(a.triangles[0].points[0], b.triangles, tolerance) || pointInside(b.triangles[0].points[0], a.triangles, tolerance))) return true;
  const nearest = new THREE.Vector3();
  for (const ta of a.triangles) for (const tb of b.triangles) {
    if (!ta.box.clone().expandByScalar(tolerance).intersectsBox(tb.box)) continue;
    if (edgesIntersect(ta, tb, tolerance) || edgesIntersect(tb, ta, tolerance)) return true;
    const triangleA = new THREE.Triangle(...ta.points), triangleB = new THREE.Triangle(...tb.points);
    if (ta.points.some((point) => triangleB.closestPointToPoint(point, nearest).distanceTo(point) <= tolerance) ||
        tb.points.some((point) => triangleA.closestPointToPoint(point, nearest).distanceTo(point) <= tolerance)) return true;
    if (Math.abs(ta.normal.dot(tb.normal)) > 0.9999 && Math.abs(ta.normal.dot(tb.points[0]) - ta.plane) <= tolerance &&
        triangleIntersectionArea(ta.points.map((p) => project(ta.normal, p)), tb.points.map((p) => project(ta.normal, p))) > 1e-8) return true;
  }
  return false;
}

function disconnected(parts, rules, groundHeight = 0) {
  const connected = new Set(parts.filter((part) => part.box.min.y <= groundHeight + rules.contactTolerance && part.box.max.y >= groundHeight - rules.contactTolerance));
  let changed = true;
  while (changed) {
    changed = false;
    for (const part of parts) {
      if (connected.has(part)) continue;
      if ([...connected].some((other) => surfacesTouch(part, other, rules.contactTolerance))) {
        connected.add(part);
        changed = true;
      }
    }
  }
  return parts.filter((part) => !connected.has(part)).map((part) => part.name);
}

function geometryHash(group) {
  group.updateMatrixWorld(true);
  const hash = createHash('sha256');
  group.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    hash.update(JSON.stringify({ name: object.name, matrix: object.matrixWorld.elements, feature: object.userData.feature,
      color: object.material.color?.getHex(), emissive: object.material.emissive?.getHex(),
      positions: Array.from(geometry.getAttribute('position').array), normals: Array.from(geometry.getAttribute('normal').array),
      indices: geometry.index ? Array.from(geometry.index.array) : null }));
  });
  return hash.digest('hex');
}

/** All hard checks share the same builder used by the game-facing registry. */
export function inspectRecipe(recipe, spec, rules, { buildRecipe, palette, accentTokens }) {
  const failures = validateRecipe(recipe, spec, rules, palette, accentTokens);
  const metrics = { checks: {}, lowerTrust: false };
  const fail = (code, message) => failures.push({ code, message });
  if (failures.length) return { failures, metrics };
  if (recipe.parts.length > rules.maxParts) fail('H2', `${recipe.parts.length} parts exceeds ${rules.maxParts}`);
  metrics.lowerTrust = recipe.parts.some((part) => part.prim === 'custom' || part.polygonOffset);
  let group, second;
  try {
    group = buildRecipe(recipe);
    second = buildRecipe(recipe);
    if (!group?.isGroup || !second?.isGroup) throw new Error('Builder must return a THREE.Group');
  } catch (error) {
    fail('BUILD', String(error?.stack || error));
    return { failures, metrics };
  }
  const hashes = [geometryHash(group), geometryHash(second)];
  if (hashes[0] !== hashes[1]) fail('H6', 'Two builds produced different geometry/material hashes');
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const triangles = [];
  const parts = [];
  const colors = new Set();
  let triangleCount = 0, nonFinite = 0, degenerate = 0, badNormals = 0;
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    if (!position || !normal || position.count !== normal.count) { badNormals++; return; }
    geometry.computeBoundingBox();
    const localSize = geometry.boundingBox.getSize(new THREE.Vector3()).multiply(mesh.scale).toArray().map(Math.abs).sort((a, b) => a - b);
    const partSpec = recipe.parts.find((part) => part.name === mesh.name);
    const minimum = partSpec?.exception ? rules.exceptionMinimumFeature : rules.minimumFeature;
    const structural = /rail|plank|post|trunk/.test(mesh.name);
    const minimumCrossSection = structural ? 0.13 : rules.minimumReadableFace;
    if (localSize[0] < minimum - 1e-6 || (!partSpec?.exception && localSize[1] < minimumCrossSection - 1e-6)) {
      fail('H5', `${mesh.name}: dimensions ${localSize.map(round).join('×')} violate minimum feature/readable face`);
    }
    if (partSpec?.feature && !partSpec.exception && !structural && localSize[0] < rules.minimumReadableThickness - 1e-6) {
      fail('H5', `${mesh.name}: readable feature is thinner than ${rules.minimumReadableThickness}`);
    }
    const mustRead = /handle|wheel|window|hat/.test(`${mesh.name} ${partSpec?.feature || ''}`);
    if (mustRead && (localSize[0] < rules.minimumReadableThickness - 1e-6 || localSize[1] < rules.minimumReadableFace - 1e-6)) {
      fail('H5', `${mesh.name}: handle/wheel/window/hat must be at least ${rules.minimumReadableThickness} thick and ${rules.minimumReadableFace} in two dimensions`);
    }
    // The bounding box of a hollow ring can be wide even when its wall is a
    // hairline. Check lathe/profile and polygon edges in local feature space.
    const profile = partSpec?.prim === 'lathe' ? partSpec.profile : partSpec?.prim === 'extrude' ? partSpec.polygon : null;
    if (profile) {
      const edgeCount = partSpec.prim === 'extrude' ? profile.length : profile.length - 1;
      for (let i = 0; i < edgeCount; i++) {
        const a = profile[i], b = profile[(i + 1) % profile.length];
        const length = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (length < minimum - 1e-6) fail('H5', `${mesh.name}: profile edge ${i} is only ${round(length)} units`);
      }
    }
    colors.add(mesh.material.color.getHex());
    const points = [], normals = [];
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i);
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      if (!finite([...point.toArray(), ...n.toArray(), ...mesh.matrixWorld.elements])) { nonFinite++; points.push(null); normals.push(null); continue; }
      if (n.length() < 0.8 || n.length() > 1.2) badNormals++;
      point.applyMatrix4(mesh.matrixWorld);
      n.applyNormalMatrix(normalMatrix);
      if (!finite([...point.toArray(), ...n.toArray()])) { nonFinite++; points.push(null); normals.push(null); continue; }
      points.push(point); normals.push(n); bounds.expandByPoint(point);
    }
    const index = geometry.getIndex();
    const count = index ? index.count : position.count;
    const partTriangles = [];
    triangleCount += Math.floor(count / 3);
    if (count % 3) fail('G_GEOMETRY', `${mesh.name} has an incomplete triangle`);
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset);
      if (ids.some((id) => !Number.isInteger(id) || id < 0 || id >= position.count)) { fail('G_GEOMETRY', `${mesh.name} has an invalid triangle index`); continue; }
      const p = ids.map((id) => points[id]), ns = ids.map((id) => normals[id]);
      if (p.some((value) => !value) || ns.some((value) => !value)) continue;
      const face = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
      if (face.length() / 2 <= rules.degenerateArea) { degenerate++; continue; }
      face.normalize();
      if (ns[0].clone().add(ns[1]).add(ns[2]).dot(face) <= 0) badNormals++;
      const triangle = { points: p, normal: face, plane: face.dot(p[0]), box: new THREE.Box3().setFromPoints(p),
        name: mesh.name, index: i / 3, offset: !!partSpec?.polygonOffset };
      triangles.push(triangle); partTriangles.push(triangle);
    }
    const box = new THREE.Box3().setFromObject(mesh);
    parts.push({ name: mesh.name, box, triangles: partTriangles });
  });
  if (nonFinite) fail('G_NON_FINITE', `${nonFinite} non-finite positions, normals or transforms`);
  if (degenerate) fail('G_DEGENERATE', `${degenerate} zero-area triangles`);
  if (badNormals) fail('G_NORMALS', `${badNormals} missing, non-unit or backwards normals`);
  if (triangleCount > rules.triBudgets[spec.category]) fail('H2', `${triangleCount} triangles exceeds ${rules.triBudgets[spec.category]}`);
  if (colors.size > rules.maxColors) fail('H1', `${colors.size} palette colours exceeds ${rules.maxColors}`);
  if (bounds.isEmpty()) fail('BUILD', 'No finite mesh geometry');
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  const dimensions = [['width', size.x, spec.size.width, recipe.footprint.w], ['depth', size.z, spec.size.depth, recipe.footprint.d],
    ['height', size.y, spec.size.height, recipe.height]];
  for (const [name, actual, expected, declared] of dimensions) {
    if (Math.abs(actual - expected) > expected * rules.dimensionToleranceRelative + 1e-6 ||
        Math.abs(declared - expected) > expected * rules.dimensionToleranceRelative + 1e-6) {
      fail('H3', `${name}: actual ${round(actual)}, declared ${declared}, brief ${expected} (±${rules.dimensionToleranceRelative * 100}%)`);
    }
  }
  for (const [axis, expected] of [['x', spec.size.width], ['z', spec.size.depth]]) {
    if (Math.abs(center[axis]) > Math.max(rules.centerToleranceAbsolute, expected * rules.centerToleranceRelative)) fail('H4', `${axis} bounds centre ${round(center[axis])} is not base-centred`);
  }
  if (Math.abs(bounds.min.y) > rules.baseTolerance) fail('H4', `bottom y ${round(bounds.min.y)} must be within ±${rules.baseTolerance}`);
  if (bounds.min.y < -rules.belowGroundTolerance) fail('H9', `bottom y ${round(bounds.min.y)} is below -${rules.belowGroundTolerance}`);
  // Do not do quadratic pairwise work on an already-rejected triangle bomb.
  // Mark the skipped checks explicitly rather than claiming they passed.
  const overBudget = triangleCount > rules.triBudgets[spec.category];
  const overlap = overBudget ? null : coplanarOverlaps(triangles, rules);
  if (overlap?.count) fail('H7', `${overlap.count} near-coplanar overlaps: ${overlap.examples.join(', ')}`);
  const floating = overBudget ? null : disconnected(parts, rules);
  if (floating?.length) fail('H8', `Disconnected parts: ${floating.join(', ')}`);
  if (recipe.collision.type === 'box') {
    const ratio = recipe.collision.w * recipe.collision.d / (recipe.footprint.w * recipe.footprint.d);
    if (ratio < rules.collisionMinRatio || ratio > rules.collisionMaxRatio) fail('H10', `collision footprint ratio ${round(ratio)} outside ${rules.collisionMinRatio}–${rules.collisionMaxRatio}`);
  } else fail('H10', 'This spec requires a collision box');
  const tagged = new Set(recipe.parts.map((part) => part.feature).filter(Boolean));
  for (const feature of spec.identityFeatures) if (!tagged.has(feature.id)) fail('IDENTITY', `No part declares identity feature ${feature.id}`);
  metrics.triangles = triangleCount; metrics.triangleBudget = rules.triBudgets[spec.category]; metrics.partCount = parts.length;
  metrics.bounds = { min: bounds.min.toArray().map(round), max: bounds.max.toArray().map(round), width: round(size.x), depth: round(size.z), height: round(size.y), centerXZ: [round(center.x), round(center.z)] };
  metrics.colorCount = colors.size; metrics.geometryHashes = hashes; metrics.zFightPairs = overlap?.count ?? null;
  metrics.disconnectedParts = floating; metrics.nonFinite = nonFinite; metrics.degenerate = degenerate; metrics.badNormals = badNormals;
  metrics.checks = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`H${i + 1}`, !failures.some((failure) => failure.code === `H${i + 1}`)]));
  if (overBudget) { metrics.checks.H7 = 'not-run'; metrics.checks.H8 = 'not-run'; }
  return { failures, metrics, group };
}

/** Compare measured face luminance normalised by albedo against a known key. */
export function checkKeyLightAgreement(samples, keyDirection) {
  const key = new THREE.Vector3(...keyDirection).normalize();
  const lit = [], shade = [];
  for (const sample of samples) {
    if (!finite([...sample.normal, sample.luminance, sample.albedo]) || sample.albedo <= 0) continue;
    const alignment = new THREE.Vector3(...sample.normal).normalize().dot(key);
    const value = sample.luminance / sample.albedo;
    if (alignment > 0.5) lit.push(value);
    else if (alignment < -0.1) shade.push(value);
  }
  if (!lit.length || !shade.length) return { status: 'unmeasured', code: 'S4', message: 'Insufficient lit/shade face samples' };
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const litMean = mean(lit), shadeMean = mean(shade);
  return { status: litMean > shadeMean ? 'pass' : 'fail', code: 'S4', litMean, shadeMean,
    message: litMean > shadeMean ? 'Key-facing samples are brighter' : 'Key-facing samples are not brighter than opposing faces' };
}

/**
 * Audit exact legacy scene geometry with the same triangle/contact routines.
 * Signed scene modules are not recipes, so schema and declared-footprint
 * checks are explicitly inapplicable; legacy exceptions are never imported
 * into the new-recipe acceptance path.
 */
export function inspectSignedGroup(group, rules, palette, category, groundHeight = 0) {
  group.updateMatrixWorld(true);
  const triangles = [], parts = [], colors = new Set(), narrowParts = [], unsupportedMaterials = [];
  let triangleCount = 0, nonFinite = 0, degenerate = 0;
  const overall = new THREE.Box3();
  let indexOfMesh = 0;
  group.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const name = `${mesh.name || 'mesh'}-${++indexOfMesh}`;
    const position = mesh.geometry.getAttribute('position');
    if (!position) { nonFinite++; return; }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material.color) colors.add(material.color.getHex());
      if (material.transparent || !material.isMeshStandardMaterial) unsupportedMaterials.push(name);
    }
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3()).multiply(mesh.scale).toArray().map(Math.abs).sort((a, b) => a - b);
    if (size[0] < rules.minimumFeature - 1e-6 || size[1] < rules.minimumReadableFace - 1e-6) narrowParts.push({ name, size: size.map(round) });
    const points = [];
    for (let i = 0; i < position.count; i++) {
      const point = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      if (!finite(point.toArray())) { nonFinite++; points.push(null); } else { points.push(point); overall.expandByPoint(point); }
    }
    const index = mesh.geometry.getIndex(), count = index ? index.count : position.count;
    triangleCount += Math.floor(count / 3);
    const partTriangles = [];
    for (let i = 0; i + 2 < count; i += 3) {
      const ids = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset);
      const p = ids.map((id) => points[id]);
      if (p.some((value) => !value)) continue;
      const normal = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
      if (normal.length() / 2 <= rules.degenerateArea) { degenerate++; continue; }
      normal.normalize();
      const groupInfo = mesh.geometry.groups.find((item) => i >= item.start && i < item.start + item.count);
      const material = materials[groupInfo?.materialIndex ?? 0] || materials[0];
      const triangle = { points: p, normal, plane: normal.dot(p[0]), box: new THREE.Box3().setFromPoints(p), name,
        index: i / 3, offset: !!material?.polygonOffset };
      triangles.push(triangle); partTriangles.push(triangle);
    }
    parts.push({ name, triangles: partTriangles, box: new THREE.Box3().setFromObject(mesh) });
  });
  const allowed = new Set(Object.values(palette));
  const offPalette = [...colors].filter((value) => !allowed.has(value)).map((value) => `#${value.toString(16).padStart(6, '0')}`);
  const overlap = coplanarOverlaps(triangles, rules);
  const floating = disconnected(parts, rules, groundHeight);
  const size = overall.getSize(new THREE.Vector3());
  return { triangleCount, triangleBudget: rules.triBudgets[category], partCount: parts.length,
    bounds: size.toArray().map(round), nonFinite, degenerate, zFightPairs: overlap.count, zFightExamples: overlap.examples,
    disconnectedParts: floating, offPalette, narrowParts, unsupportedMaterials,
    scope: 'Exact signed meshes; recipe schema/declared collision are not applicable. Differences are reported, not waived for new assets.' };
}
