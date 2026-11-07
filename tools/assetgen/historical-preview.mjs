import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import * as THREE from 'three';
import { evidenceDirectory, goldenDirectory, readBible, readSpec, root } from './config.mjs';
import { inspectRecipe } from './geometry.mjs';
import { createVisualRunner } from './visual.mjs';
import { verifierSourceHash } from './bundle.mjs';

// Preview old, already-generated candidates under the merged renderer without
// promoting or changing them. The old bevelBox is converted to equivalent
// lower-trust geometry for display only; no new asset is authored here.
function displayRecipe(source) {
  const recipe = structuredClone(source);
  for (const part of recipe.parts) {
    if (part.prim !== 'bevelBox') continue;
    const [width, height, depth] = part.size;
    const bevel = part.bevel ?? Math.min(width, height, depth) * 0.08;
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2 + bevel, -height / 2 + bevel);
    shape.lineTo(width / 2 - bevel, -height / 2 + bevel);
    shape.lineTo(width / 2 - bevel, height / 2 - bevel);
    shape.lineTo(-width / 2 + bevel, height / 2 - bevel);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true,
      bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1, curveSegments: 1 });
    geometry.translate(0, 0, -depth / 2 + bevel);
    const positions = Array.from(geometry.getAttribute('position').array);
    part.prim = 'custom';
    part.positions = positions;
    part.indices = geometry.index ? Array.from(geometry.index.array) : Array.from({ length: positions.length / 3 }, (_, index) => index);
    delete part.size; delete part.bevel;
  }
  return recipe;
}

const runner = await createVisualRunner();
try {
  const bible = await readBible();
  const previewDir = process.env.ASSETGEN_PREVIEW_DIR || 'historical';
  if (!/^[a-z0-9-]+$/.test(previewDir)) throw new Error('Invalid preview directory label');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  let trackedDirty = false;
  try { execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: root }); } catch { trackedDirty = true; }
  const sourceHash = await verifierSourceHash();
  const { buildRecipe } = await runner.server.ssrLoadModule('/src/assets/buildRecipe.ts');
  const { ASSET_PALETTE, ACCENT_TOKENS } = await runner.server.ssrLoadModule('/src/assets/palette.ts');
  for (const id of ['barrel', 'hay-bale', 'round-oak']) {
    const { spec } = await readSpec(id);
    const previous = JSON.parse(await readFile(join(goldenDirectory, 'historical', `${id}.json`), 'utf8'));
    const hard = inspectRecipe(previous, spec, bible.rules, { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS });
    const display = displayRecipe(previous);
    const output = join(evidenceDirectory, 'ebr83-85', previewDir, id);
    await mkdir(output, { recursive: true });
    if (process.argv.includes('--references-only')) {
      await runner.reference(spec, join(output, 'b-reference-transparent.png'), display);
      console.log(`${id}: transparent A-derived reference only`);
      continue;
    }
    const visual = await runner.capture(spec, bible.rules, output, display);
    await runner.reference(spec, join(output, 'b-reference-transparent.png'), display);
    const report = { id, status: 'needs-human', signedBy: null, head, trackedDirty, verifierHash: sourceHash,
      origin: 'pre-EBR-80 generated candidate, not a new run',
      displayConversion: id === 'hay-bale' ? 'old bevelBox converted to custom triangles solely for preview' : 'none',
      hard: { failures: hard.failures, metrics: hard.metrics }, visual,
      warning: 'Diagnostic render of historical candidate; no current critic or bundle eligibility.' };
    await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${id}: ${hard.failures.map((failure) => failure.code).join(', ') || 'hard checks clear'}; historical display only`);
  }
} finally { await runner.close(); }
