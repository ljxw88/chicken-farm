import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const specDirectory = join(root, 'tools/assetgen/specs');
// Preserve the prior pre-EBR-80 bake-off and permit isolated loop-off runs.
export const runDirectory = process.env.ASSETGEN_RUN_DIR ? resolve(process.env.ASSETGEN_RUN_DIR) : join(root, 'tools/assetgen/runs-ebr83-85');
export const evidenceDirectory = join(root, 'evidence/assetgen');
export const biblePath = join(root, 'docs/asset-style-bible.md');
export const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const categories = ['prop', 'flora', 'building', 'terrain'];

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
