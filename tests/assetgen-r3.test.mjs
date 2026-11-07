import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { readBible, root } from '../tools/assetgen/config.mjs';
import { inspectRecipe } from '../tools/assetgen/geometry.mjs';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
const { buildRecipe } = await vite.ssrLoadModule('/src/assets/buildRecipe.ts');
const { ASSET_PALETTE, ACCENT_TOKENS } = await vite.ssrLoadModule('/src/assets/palette.ts');
const { rules } = await readBible();
const fixture = JSON.parse(await readFile(join(root, 'tests/fixtures/assetgen/qa2-barrel.fixture.json'), 'utf8'));
after(() => vite.close());
const inspect = (name, mutate) => {
  const { spec, recipe } = structuredClone(fixture);
  spec.id = name; recipe.id = name;
  mutate(recipe);
  return inspectRecipe(recipe, spec, rules, { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS });
};

test('QA2 f-sliver-coplanar-inside reports H5 and H7 for a skin straddling the lid', () => {
  const result = inspect('f-sliver-coplanar-inside', (recipe) => recipe.parts.push({ name: 'lid-skin', prim: 'box',
    size: [0.5, 0.04, 0.5], at: [0, 1, 0], mat: 'timber' }));
  assert.ok(result.failures.some((failure) => failure.code === 'H5'));
  assert.ok(result.failures.some((failure) => failure.code === 'H7' && failure.message.includes('lid-skin/lid')), JSON.stringify(result.failures));
});

test('a thin part wholly inside the lid is not reported as a face crossing', () => {
  const result = inspect('interior-skin', (recipe) => recipe.parts.push({ name: 'lid-skin', prim: 'box',
    size: [0.4, 0.04, 0.4], at: [0, 0.9, 0], mat: 'timber' }));
  assert.ok(result.failures.some((failure) => failure.code === 'H5'));
  assert.ok(!result.failures.some((failure) => failure.code === 'H7'), JSON.stringify(result.failures));
});

test('QA2 f-vertexcolors-custom reports BAKED_LIGHT rather than H1', () => {
  const result = inspect('f-vertexcolors-custom', (recipe) => recipe.parts.push({ name: 'tinted', prim: 'custom',
    positions: [0, 0, 0, 0.3, 0, 0, 0, 0.3, 0], indices: [0, 1, 2], colors: [0, 0, 0, 1, 1, 1, 0.2, 0.2, 0.2],
    at: [0, 0.4, 0], mat: 'wood.mid' }));
  assert.ok(result.failures.some((failure) => failure.code === 'BAKED_LIGHT'));
  assert.ok(!result.failures.some((failure) => failure.code === 'H1'), JSON.stringify(result.failures));
});

test('a singular raw colour string remains an H1 palette violation', () => {
  const result = inspect('f-color-field', (recipe) => { recipe.parts[0].color = '#ff00ff'; });
  assert.ok(result.failures.some((failure) => failure.code === 'H1'));
  assert.ok(!result.failures.some((failure) => failure.code === 'BAKED_LIGHT'));
});
