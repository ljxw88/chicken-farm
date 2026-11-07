import * as THREE from 'three';
import { validateRecipe } from './schema.mjs';

// Fit only modest geometry overshoots/undershoots from the model. This is a
// recipe transformation, not an exemption from any subsequent hard check.
// Rotations and jitter would make per-part local scaling differ from scaling
// the whole object in world space, so leave those recipes for model correction.
export function fitGeneratedRecipe(recipe, spec, rules, { buildRecipe, palette, accentTokens }) {
  const unchanged = { recipe, normalization: null };
  if (validateRecipe(recipe, spec, rules, palette, accentTokens).length) return unchanged;
  if (recipe.parts.some((part) => (part.rot || []).some((value) => value !== 0) ||
      Object.values(part.jitter || {}).some((value) => value !== 0))) return unchanged;

  const target = [spec.size.width, spec.size.height, spec.size.depth];
  const declared = [recipe.footprint.w, recipe.height, recipe.footprint.d];
  const tolerance = rules.dimensionToleranceRelative;
  if (declared.some((value, i) => Math.abs(value - target[i]) > target[i] * tolerance + 1e-6)) return unchanged;

  let bounds;
  try {
    const group = buildRecipe(recipe);
    group.updateMatrixWorld(true);
    bounds = new THREE.Box3().setFromObject(group, true);
  } catch { return unchanged; }
  const size = bounds.getSize(new THREE.Vector3()).toArray();
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray(), ...size].every(Number.isFinite) ||
      size.some((value, i) => value <= 0 || value / target[i] < 0.75 || value / target[i] > 1.25)) return unchanged;

  const factors = size.map((value, i) => Math.abs(value - target[i]) > target[i] * tolerance + 1e-6 ? target[i] / value : 1);
  if (factors.every((value) => value === 1)) return unchanged;
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
  return { recipe: fitted, normalization: { method: 'axis-aligned-origin-v1', factors, originalBounds: {
    min: bounds.min.toArray(), max: bounds.max.toArray(), size }, target } };
}
