import * as THREE from 'three';
import { inspectRecipe } from './geometry.mjs';
import { validateRecipe } from './schema.mjs';

// Fit only modest geometry overshoots/undershoots from the model. This is a
// recipe transformation, not an exemption from any subsequent hard check.
export function fitGeneratedRecipe(recipe, spec, rules, environment) {
  const { buildRecipe, palette, accentTokens } = environment;
  const unchanged = { recipe, normalization: null };
  if (validateRecipe(recipe, spec, rules, palette, accentTokens).length) return unchanged;

  const target = [spec.size.width, spec.size.height, spec.size.depth];
  const declared = [recipe.footprint.w, recipe.height, recipe.footprint.d];
  const tolerance = rules.dimensionToleranceRelative;
  if (declared.some((value, i) => Math.abs(value - target[i]) > target[i] * tolerance + 1e-6)) return unchanged;

  let bounds, group;
  try {
    group = buildRecipe(recipe);
    group.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(group, true);
  } catch { return unchanged; }
  const size = bounds.getSize(new THREE.Vector3()).toArray();
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray(), ...size].every(Number.isFinite) ||
      size.some((value, i) => value <= 0 || value / target[i] < 0.75 || value / target[i] > 1.25)) return unchanged;

  const factors = size.map((value, i) => Math.abs(value - target[i]) > target[i] * tolerance + 1e-6 ? target[i] / value : 1);
  if (factors.every((value) => value === 1)) return unchanged;
  const originalBounds = { min: bounds.min.toArray(), max: bounds.max.toArray(), size };

  // Prefer moving only overhanging parts by at most 0.03 units. Translation
  // preserves their thickness even with rotation/jitter. Do not use it for an
  // undersized axis, or if it introduces any new non-H3 failure.
  if (size.every((value, i) => value >= target[i] * (1 - tolerance) - 1e-6)) {
    const translated = structuredClone(recipe);
    const offsets = {};
    let possible = true;
    for (const part of translated.parts) {
      const mesh = group.getObjectByName(part.name);
      if (!mesh) { possible = false; break; }
      const partBox = new THREE.Box3().setFromObject(mesh, true);
      const min = partBox.min.toArray(), max = partBox.max.toArray();
      const delta = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        if (factors[i] === 1) continue;
        const span = target[i] * (1 + tolerance * 0.9);
        const center = (originalBounds.min[i] + originalBounds.max[i]) / 2;
        const low = i === 1 ? originalBounds.min[i] : center - span / 2;
        const high = low + span;
        if (max[i] - min[i] > span + 1e-6) { possible = false; break; }
        delta[i] = min[i] < low ? low - min[i] : max[i] > high ? high - max[i] : 0;
        if (Math.abs(delta[i]) > rules.jitterMaximum + 1e-6) { possible = false; break; }
      }
      if (!possible) break;
      if (delta.some((value) => value !== 0)) {
        offsets[part.name] = delta;
        part.at = part.at.map((value, i) => value + delta[i]);
      }
    }
    if (possible && Object.keys(offsets).length) {
      const before = inspectRecipe(recipe, spec, rules, environment).failures;
      const after = inspectRecipe(translated, spec, rules, environment).failures;
      const counts = (items) => items.filter((item) => item.code !== 'H3').reduce((map, item) => map.set(item.code, (map.get(item.code) || 0) + 1), new Map());
      const beforeCounts = counts(before), afterCounts = counts(after);
      if (!after.some((item) => item.code === 'H3') && [...afterCounts].every(([code, count]) => count <= (beforeCounts.get(code) || 0))) {
        return { recipe: translated, normalization: { method: 'boundary-translation-v1', offsets, originalBounds, target } };
      }
    }
  }

  // Nonuniform world scaling cannot be represented by the recipe's local
  // scale when a part is rotated or jittered. Leave those for correction.
  if (recipe.parts.some((part) => (part.rot || []).some((value) => value !== 0) ||
      Object.values(part.jitter || {}).some((value) => value !== 0))) return unchanged;
  const fitted = structuredClone(recipe);
  for (const part of fitted.parts) {
    part.at = part.at.map((value, i) => value * factors[i]);
    part.scale = (part.scale || [1, 1, 1]).map((value, i) => value * factors[i]);
    if (Math.max(...part.scale) / Math.min(...part.scale) > rules.maxScaleRatio) return unchanged;
  }
  for (const key of Object.keys(fitted.anchors)) fitted.anchors[key] = fitted.anchors[key].map((value, i) => value * factors[i]);

  // Rebuild before accepting the transform; the ordinary verifier will then
  // check this exact recipe, including H3, H5, contact and collision.
  try {
    const group = buildRecipe(fitted);
    group.updateMatrixWorld(true);
    const fittedSize = new THREE.Box3().setFromObject(group, true).getSize(new THREE.Vector3()).toArray();
    if (fittedSize.some((value, i) => !Number.isFinite(value) || Math.abs(value - target[i]) > target[i] * tolerance + 1e-6)) return unchanged;
  } catch { return unchanged; }
  return { recipe: fitted, normalization: { method: 'axis-aligned-origin-v1', factors, originalBounds, target } };
}
