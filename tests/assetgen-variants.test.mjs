import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { readBible, readSpec, validateSpec, variantReferences } from '../tools/assetgen/config.mjs';
import { makePrompt } from '../tools/assetgen/generator.mjs';
import { inspectRecipe } from '../tools/assetgen/geometry.mjs';

const server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
const { buildRecipe } = await server.ssrLoadModule('/src/assets/buildRecipe.ts');
const { ASSET_PALETTE, ACCENT_TOKENS } = await server.ssrLoadModule('/src/assets/palette.ts');
const bible = await readBible();
const environment = { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS };
after(() => server.close());

const spec = { id: 'rock-c', category: 'terrain', brief: 'A chunky rock with three distinct visible features.',
  size: { width: 0.8, depth: 0.8, height: 0.96 }, paletteHints: ['stone'], referenceAssetIds: ['signed-fence'],
  variantOf: 'rock-a', distinctFrom: ['rock-b'], variationSeed: 41,
  identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'cap', description: 'A broad cap' }, { id: 'top', description: 'A raised top' }] };
const recipe = { id: spec.id, category: spec.category, footprint: { w: 0.8, d: 0.8 }, height: 0.96, origin: 'base-center', facing: '+Z',
  parts: [
    { name: 'body', prim: 'box', size: [0.8, 0.6, 0.8], at: [0, 0.3, 0], mat: 'stone', feature: 'body', seed: 41, jitter: { position: 0.03 } },
    { name: 'cap', prim: 'box', size: [0.7, 0.2, 0.7], at: [0, 0.68, 0], mat: 'stone', feature: 'cap' },
    { name: 'top', prim: 'box', size: [0.3, 0.2, 0.3], at: [0, 0.86, 0], mat: 'stone', feature: 'top' },
  ], anchors: {}, collision: { type: 'box', w: 0.8, d: 0.8, h: 0.96 }, slots: {}, tags: [], emissive: [] };
const copy = () => structuredClone(recipe);

test('P0 variant specs use distinct geometry seeds and reference each earlier variant', async () => {
  const ids = ['round-oak-a', 'round-oak-b', 'rock-a', 'rock-b', 'rock-c'];
  const specs = await Promise.all(ids.map(async (id) => (await readSpec(id)).spec));
  assert.equal(new Set(specs.map((item) => item.variationSeed)).size, ids.length);
  assert.deepEqual(variantReferences(specs[1]), ['round-oak-a']);
  assert.deepEqual(variantReferences(specs[3]), ['rock-a']);
  assert.deepEqual(variantReferences(specs[4]), ['rock-a', 'rock-b']);
  assert.ok(specs.slice(2).every((item) => item.size.height >= 0.3 && item.size.height <= 0.8));
});

test('variant seed must be an actual nonzero deterministic geometry jitter', () => {
  for (const jitter of [undefined, { position: 0 }, { rotation: 0 }]) {
    const input = copy(); input.parts[0].jitter = jitter;
    assert.ok(inspectRecipe(input, spec, bible.rules, environment).failures.some((failure) => failure.code === 'VARIANT_SEED'));
  }
  const wrong = copy(); wrong.parts[0].seed = 42;
  assert.ok(inspectRecipe(wrong, spec, bible.rules, environment).failures.some((failure) => failure.code === 'VARIANT_SEED'));
  assert.ok(!inspectRecipe(copy(), spec, bible.rules, environment).failures.some((failure) => failure.code === 'VARIANT_SEED'));
});

test('all variant references are mandatory and a seeded recolour is still a copy', () => {
  const first = copy(); first.id = 'rock-a'; first.parts[0].size[0] = 0.55;
  const second = copy(); second.id = 'rock-b'; second.parts[0].seed = 99; second.parts[0].mat = 'dirt.hi';
  const missing = inspectRecipe(copy(), spec, bible.rules, { ...environment, referenceRecipes: { 'rock-a': first } });
  assert.ok(missing.failures.some((failure) => failure.code === 'VARIANT_REFERENCE_MISSING' && failure.message.includes('rock-b')));
  const compared = inspectRecipe(copy(), spec, bible.rules, { ...environment, referenceRecipes: { 'rock-a': first, 'rock-b': second } });
  assert.ok(compared.failures.some((failure) => failure.code === 'VARIANT_RECOLOR' && failure.message.includes('rock-b')));
  assert.ok(!compared.failures.some((failure) => failure.code === 'VARIANT_RECOLOR' && failure.message.includes('rock-a')));
});

test('variant metadata rejects invalid or duplicate references and seeds', () => {
  assert.throws(() => validateSpec({ ...spec, distinctFrom: ['rock-a'] }), /distinctFrom/);
  assert.throws(() => validateSpec({ ...spec, distinctFrom: ['rock-b', 'rock-b'] }), /distinctFrom/);
  assert.throws(() => validateSpec({ ...spec, variationSeed: -1 }), /variationSeed/);
  assert.throws(() => validateSpec({ ...spec, variantOf: 123 }), /variantOf/);
});

test('the generator receives the seed and the prior silhouette recipes', async () => {
  const reference = copy(); reference.id = 'rock-a';
  const prompt = await makePrompt(spec, bible, 'blockout', null, null, null, { 'rock-a': reference });
  assert.match(prompt, /VARIATION SEED 41/);
  assert.match(prompt, /not the model's sampling/);
  assert.match(prompt, /OTHER VARIANT RECIPES/);
  assert.match(prompt, /"rock-a"/);
});
