import { readFile, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const specDirectory = join(root, 'tools/assetgen/specs');
export const goldenDirectory = join(root, 'tools/assetgen/golden');
let head = 'unversioned';
try { head = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
catch { /* Standalone fixture copies need no git checkout. */ }
const evidenceRoot = join(homedir(), 'OpenBot/Shared/farm-evidence/EBR-85');
export const evidenceDirectory = process.env.ASSETGEN_EVIDENCE_DIR ? resolve(process.env.ASSETGEN_EVIDENCE_DIR) : join(evidenceRoot, head);
export const runDirectory = process.env.ASSETGEN_RUN_DIR ? resolve(process.env.ASSETGEN_RUN_DIR) : join(evidenceDirectory, 'runs');
export const archiveDirectory = process.env.ASSETGEN_ARCHIVE_DIR ? resolve(process.env.ASSETGEN_ARCHIVE_DIR) : join(evidenceRoot, 'pr21-tracked');
export const biblePath = join(root, 'docs/asset-style-bible.md');
export const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const categories = ['prop', 'flora', 'building', 'terrain'];

/** Prefer a fresh probe; a malformed current probe must not fall back to a pass. */
export async function readVisionProbe() {
  try { return JSON.parse(await readFile(join(evidenceDirectory, 'vision-probe-ebr83-85/result.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') return null;
    try { return JSON.parse(await readFile(join(goldenDirectory, 'vision-probe.json'), 'utf8')); }
    catch { return null; }
  }
}

export async function readBible() {
  const text = await readFile(biblePath, 'utf8');
  const block = text.match(/```assetgen-rules\s*\n([\s\S]*?)\n```/);
  if (!block) throw new Error('The style bible is missing its assetgen-rules block');
  return { text, rules: JSON.parse(block[1]) };
}

export function validateSpec(spec) {
  if (!spec || !idPattern.test(spec.id) || !categories.includes(spec.category)) throw new Error('Invalid spec id or category');
  if (typeof spec.brief !== 'string' || spec.brief.trim().length < 25) throw new Error('Spec needs a descriptive brief');
  if (!spec.size || !['width', 'depth', 'height'].every((key) => Number.isFinite(spec.size[key]) && spec.size[key] > 0)) {
    throw new Error('Spec size must have positive width, depth and height');
  }
  for (const field of ['paletteHints', 'referenceAssetIds']) {
    if (!Array.isArray(spec[field]) || !spec[field].length || !spec[field].every((item) => typeof item === 'string')) {
      throw new Error(`Spec needs a nonempty ${field} array`);
    }
  }
  if (!Array.isArray(spec.identityFeatures) || spec.identityFeatures.length < 3 || spec.identityFeatures.length > 5 ||
      !spec.identityFeatures.every((feature) => idPattern.test(feature.id) && typeof feature.description === 'string' && feature.description.length > 5) ||
      new Set(spec.identityFeatures.map((feature) => feature.id)).size !== spec.identityFeatures.length) {
    throw new Error('Spec needs 3–5 uniquely named identityFeatures with descriptions');
  }
  if (spec.variantOf !== undefined && (!idPattern.test(spec.variantOf) || spec.variantOf === spec.id)) throw new Error('variantOf must name a different valid asset id');
  return spec;
}

export async function readSpec(input) {
  const path = input.endsWith('.json') || input.includes('/') ? resolve(root, input) : join(specDirectory, `${input}.json`);
  const spec = validateSpec(JSON.parse(await readFile(path, 'utf8')));
  return { spec, path };
}

export async function listSpecs() {
  const names = (await readdir(specDirectory)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map((name) => readSpec(join(specDirectory, name))));
}

export function recipePath(spec) {
  validateSpec(spec);
  return join(runDirectory, spec.id, 'candidate.json');
}
