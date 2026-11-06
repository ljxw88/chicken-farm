import * as THREE from 'three';
import { geometryHash, inspectSignedGroup } from './geometry.mjs';

const expected = {
  tree: { category: 'flora', ground: 2.4, triangles: 364, size: [2.04, 2.8, 1.7] },
  coop: { category: 'building', ground: 2.4, triangles: 220, size: [1.7, 1.95, 2.55] },
  fence: { category: 'prop', ground: 0, triangles: 48, size: [1.47, 0.95, 0.215] },
  tread: { category: 'terrain', ground: 0, triangles: 44, size: [0.9, 2.4, 1.2] },
};

export async function createSignedFixtures(server) {
  const [{ createFarmLayout }, { createPlacementVisual }, { createStoneStairs }] = await Promise.all([
    server.ssrLoadModule('/src/scene/createFarmLayout.ts'), server.ssrLoadModule('/src/placement/createPlacementVisual.ts'),
    server.ssrLoadModule('/src/scene/createStoneStairs.ts'),
  ]);
  function build(name) {
    if (name === 'fence') return createPlacementVisual('fence');
    if (name === 'tread') return createStoneStairs(new THREE.Group(), 16, 2.4, 0).treads[0];
    const scene = new THREE.Scene(); createFarmLayout(scene);
    return scene.getObjectByName(name === 'tree' ? 'farm-tree-2' : name === 'coop' ? 'farm-ramp-coop-1' : '');
  }
  return { names: Object.keys(expected), build, expected };
}

/** Only these exact named game references get the signed-legacy audit path. */
export function inspectSignedFixture(name, group, rebuilt, rules, palette, baseline) {
  const target = expected[name];
  if (!target || !group || !rebuilt) return { status: 'FAIL', failures: [{ code: 'SIGNED_UNKNOWN', message: `Unknown signed fixture ${name}` }] };
  const metrics = inspectSignedGroup(group, rules, palette, target.category, target.ground);
  const hashes = [geometryHash(group), geometryHash(rebuilt)];
  const failures = [];
  if (metrics.nonFinite || metrics.degenerate) failures.push({ code: 'G_GEOMETRY', message: 'Signed geometry has non-finite or degenerate triangles' });
  if (metrics.triangleCount !== target.triangles || metrics.triangleCount > metrics.triangleBudget) failures.push({ code: 'H2', message: 'Signed triangle count differs from the known baseline' });
  if (metrics.bounds.some((value, index) => Math.abs(value - target.size[index]) > 0.08)) failures.push({ code: 'H3', message: 'Signed bounds differ from the known baseline' });
  if (metrics.disconnectedParts.length) failures.push({ code: 'H8', message: `Signed fixture has disconnected parts: ${metrics.disconnectedParts.join(', ')}` });
  if (hashes[0] !== hashes[1]) failures.push({ code: 'H6', message: 'Signed reference builds are not deterministic' });
  if (baseline && hashes[0] !== baseline[name]) failures.push({ code: 'SIGNED_CHANGED', message: 'Signed geometry/material fingerprint changed; re-baseline only with QA approval' });
  const warnings = [];
  if (metrics.zFightPairs) warnings.push({ code: 'A7_ANALYTIC_WARNING', message: `${metrics.zFightPairs} coplanar pairs in signed legacy geometry; empirical flicker must be assessed separately` });
  if (metrics.narrowParts.length || metrics.offPalette.length || metrics.unsupportedMaterials.length) warnings.push({ code: 'SIGNED_LEGACY',
    message: 'Exact signed reference includes legacy small details, palette-derived treads or a game contact shadow; these are not exemptions for new recipes' });
  return { status: failures.length ? 'FAIL' : 'PASS_SIGNED_GEOMETRY', failures, warnings, metrics: { ...metrics, hashes },
    notChecked: ['A7 empirical jitter until browser audit', 'A11 placement', 'A12 walking shimmer', 'A13 Look Dev'] };
}
