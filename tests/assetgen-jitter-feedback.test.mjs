import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBible } from '../tools/assetgen/config.mjs';
import { makePrompt, revisionFeedback } from '../tools/assetgen/generator.mjs';
import { validateRecipe } from '../tools/assetgen/schema.mjs';

const bible = await readBible();
const spec = { id: 'jitter-fixture', category: 'flora', brief: 'A chunky foliage fixture with three visible features.',
  size: { width: 1, depth: 1, height: 1 }, paletteHints: ['foliage.mid'], referenceAssetIds: ['signed-fence'], variationSeed: 84001,
  identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'cap', description: 'A broad cap' }, { id: 'top', description: 'A raised top' }] };
const recipe = { id: spec.id, category: spec.category, footprint: { w: 1, d: 1 }, height: 1, origin: 'base-center', facing: '+Z',
  parts: [{ name: 'left-lobe', prim: 'box', size: [1, 1, 1], at: [0, 0.5, 0], mat: 'foliage.mid', feature: 'body',
    jitter: { seed: 84001, max: [0.03, 0.02, 0.03], rot: [0.01, 0.02, 0.03] } }],
  anchors: {}, collision: { type: 'box', w: 1, d: 1, h: 1 }, slots: {}, tags: [], emissive: [] };
const validate = (input) => validateRecipe(input, spec, bible.rules, { 'foliage.mid': 0x456789 }, []);

test('nested jitter is rejected with exact forbidden fields and the sibling-seed correction', () => {
  const failures = validate(recipe);
  for (const field of ['seed', 'max', 'rot']) assert.ok(failures.some((failure) => failure.code === 'H1' && failure.message === `part left-lobe jitter: forbidden or unknown field ${field}`));
  assert.ok(failures.some((failure) => failure.code === 'H1' && failure.message.includes('integer seed on the part, beside jitter')));
  assert.ok(failures.some((failure) => failure.code === 'VARIANT_SEED'));
});

test('valid sibling seed works, while extra fields, arrays and excessive jitter still fail H1', () => {
  const good = structuredClone(recipe); good.parts[0].seed = 84001; good.parts[0].jitter = { rotation: 0.01 };
  assert.deepEqual(validate(good), []);
  for (const jitter of [{ rotation: 0.031 }, { position: [0.01, 0, 0] }, { rotation: 0.01, seed: 84001 }, null]) {
    const bad = structuredClone(good); bad.parts[0].jitter = jitter;
    assert.ok(validate(bad).some((failure) => failure.code === 'H1'), JSON.stringify(jitter));
  }
});

test('every exact jitter error reaches the correction prompt even after fifteen other blockers', async () => {
  const failures = validate(recipe);
  const blockers = [...Array.from({ length: 20 }, (_, i) => ({ code: 'H5', message: `earlier failure ${i}` })), ...failures];
  const feedback = revisionFeedback({ action: 'refine-code', diff: {}, hard: { failures, metrics: {} }, blockers, visual: null, critique: null });
  for (const failure of failures) assert.ok(feedback.failures.some((item) => item.code === failure.code && item.message === failure.message));
  const prompt = await makePrompt(spec, bible, 'blockout', recipe, feedback, null);
  for (const failure of failures) assert.ok(prompt.includes(`${failure.code}: ${failure.message}`));
  assert.match(prompt, /"seed":84001,"jitter":\{"rotation":0\.01\}/);
  assert.match(prompt, /NEVER inside it/);
  assert.match(prompt, /lowercase kebab-case/);
});
