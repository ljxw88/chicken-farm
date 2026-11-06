import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const specDirectory = join(root, 'tools/assetgen/specs');
export const runDirectory = join(root, 'tools/assetgen/runs');
export const evidenceDirectory = join(root, 'evidence/assetgen');
export const biblePath = join(root, 'docs/asset-style-bible.md');
export const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const categories = ['trees', 'rocks', 'fences', 'props', 'farm'];

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

export function assetPath(spec) {
  validateSpec(spec);
  return join(root, 'src/assets', spec.category, `${spec.id}.ts`);
}

export function qualifiedPalette(farm, building) {
  return Object.fromEntries([
    ...Object.entries(farm).map(([key, value]) => [`farm.${key}`, value]),
    ...Object.entries(building).map(([key, value]) => [`building.${key}`, value]),
  ]);
}
