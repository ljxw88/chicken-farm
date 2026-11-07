import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { auditBundleEntry, hashText } from '../tools/assetgen/bundle.mjs';
import { readBible } from '../tools/assetgen/config.mjs';
import { fitGeneratedRecipe } from '../tools/assetgen/fit-generated.mjs';
import { makePrompt } from '../tools/assetgen/generator.mjs';
import { inspectRecipe } from '../tools/assetgen/geometry.mjs';

const server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
const { buildRecipe } = await server.ssrLoadModule('/src/assets/buildRecipe.ts');
const { ASSET_PALETTE, ACCENT_TOKENS } = await server.ssrLoadModule('/src/assets/palette.ts');
const bible = await readBible();
const environment = { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS };
after(() => server.close());

const spec = { id: 'fit-bucket', category: 'prop', brief: 'A small wooden container with a broad arched handle.',
  size: { width: 0.52, height: 0.62, depth: 0.48 }, paletteHints: ['wood.mid'], referenceAssetIds: ['signed-fence'],
  identityFeatures: [{ id: 'body', description: 'Broad bucket body' }, { id: 'top', description: 'Inset top surface' }, { id: 'handle', description: 'Broad bucket handle' }] };
const recipe = { id: spec.id, category: spec.category, footprint: { w: 0.52, d: 0.48 }, height: 0.62, origin: 'base-center', facing: '+Z',
  parts: [
    { name: 'body', prim: 'cylinder', radiusTop: 0.25, radiusBottom: 0.25, h: 0.3, segments: 8, at: [0, 0.15, 0], mat: 'wood.mid', feature: 'body' },
    { name: 'top', prim: 'cylinder', radiusTop: 0.2, radiusBottom: 0.2, h: 0.2, segments: 8, at: [0, 0.36, 0], mat: 'timber', feature: 'top' },
    { name: 'handle', prim: 'extrude', polygon: [[-0.24, 0], [0.24, 0], [0.24, 0.32], [-0.24, 0.32]], depth: 0.3,
      at: [0, 0.3, -0.15], mat: 'timber', feature: 'handle' },
  ], anchors: { grip: [0, 0.62, -0.15] }, collision: { type: 'box', w: 0.52, d: 0.48, h: 0.62 }, slots: {}, tags: [], emissive: [] };
const inspect = (value = recipe) => inspectRecipe(value, spec, bible.rules, environment);
const fit = (value = recipe) => fitGeneratedRecipe(value, spec, bible.rules, environment);

test('bounded fit corrects the built handle depth while retaining metadata and the original recipe', () => {
  const before = structuredClone(recipe);
  assert.ok(inspect().failures.some((failure) => failure.code === 'H3' && failure.message.includes('depth: actual 0.55')));
  const { recipe: fitted, normalization } = fit();
  assert.equal(normalization.method, 'axis-aligned-origin-v1');
  assert.ok(Math.abs(normalization.factors[2] - 0.48 / 0.55) < 1e-6);
  assert.deepEqual(recipe, before);
  assert.deepEqual(fitted.footprint, recipe.footprint);
  assert.deepEqual(fitted.collision, recipe.collision);
  assert.ok(Math.abs(fitted.anchors.grip[2] - recipe.anchors.grip[2] * normalization.factors[2]) < 1e-9);
  const checked = inspect(fitted);
  assert.equal(checked.metrics.bounds.depth, 0.48);
  assert.ok(!checked.failures.some((failure) => failure.code === 'H3'), JSON.stringify(checked.failures));
  assert.deepEqual(fit(), { recipe: fitted, normalization });
});

test('fit never repairs wrong declarations or grossly wrong dimensions', () => {
  const wrongMetadata = structuredClone(recipe); wrongMetadata.footprint.d = 0.8;
  assert.equal(fit(wrongMetadata).normalization, null);
  assert.ok(inspect(wrongMetadata).failures.some((failure) => failure.code === 'H3'));
  const wrongScale = structuredClone(recipe); wrongScale.parts[0].radiusTop = wrongScale.parts[0].radiusBottom = 1;
  assert.equal(fit(wrongScale).normalization, null);
  assert.ok(inspect(wrongScale).failures.some((failure) => failure.code === 'H3'));
});

test('fit leaves rotated or jittered geometry to an explicit correction', () => {
  for (const transform of [{ rot: [0, 1, 0] }, { seed: 1, jitter: { position: 0.01 } }]) {
    const input = structuredClone(recipe); Object.assign(input.parts[2], transform);
    assert.deepEqual(fit(input), { recipe: input, normalization: null });
    assert.ok(inspect(input).failures.some((failure) => failure.code === 'H3'));
  }
});

test('scaled polygon and lathe profile edges cannot bypass H5', () => {
  const polygon = structuredClone(recipe);
  polygon.parts[2].polygon = [[-0.24, 0], [-0.135, 0], [-0.135, 0.32], [-0.24, 0.32]];
  polygon.parts[2].scale = [0.8, 1, 1];
  assert.ok(inspect(polygon).failures.some((failure) => failure.code === 'H5' && failure.message.includes('profile edge')));
  polygon.parts[2].polygon[1][0] = polygon.parts[2].polygon[2][0] = -0.15; // Original edge is only 0.09.
  polygon.parts[2].scale = [2, 1, 1];
  assert.ok(inspect(polygon).failures.some((failure) => failure.code === 'H5' && failure.message.includes('profile edge')));
  const lathe = structuredClone(recipe);
  lathe.parts[2] = { name: 'handle', prim: 'lathe', profile: [[0.1, 0], [0.205, 0], [0.205, 0.32]], segments: 8,
    at: [0, 0.3, -0.15], scale: [0.8, 1, 1], mat: 'timber', feature: 'handle' };
  assert.ok(inspect(lathe).failures.some((failure) => failure.code === 'H5' && failure.message.includes('profile edge')));
});

test('fit does not exempt geometry from the other hard gates', () => {
  const input = structuredClone(recipe);
  input.parts.push({ ...structuredClone(input.parts[0]), name: 'duplicate' });
  const { recipe: fitted, normalization } = fit(input);
  assert.ok(normalization);
  assert.ok(inspect(fitted).failures.some((failure) => failure.code === 'H7'));
  const collision = structuredClone(recipe); collision.collision.w = 2;
  assert.ok(inspect(fit(collision).recipe).failures.some((failure) => failure.code === 'H10'));
});

test('correction prompt identifies the measured boundary parts and exact ranges', async () => {
  const checked = inspect();
  const prompt = await makePrompt(spec, bible, 'blockout', recipe,
    { failures: checked.failures, hard: checked.metrics }, null);
  assert.match(prompt, /depth \(Z\): target 0\.48, permitted 0\.432–0\.528/);
  assert.match(prompt, /depth \(Z\): measured 0\.55, min -0\.3 \[handle\], max 0\.25 \[body\]/);
  assert.match(prompt, /centred on at\[2\].*depth\/2/);
});

test('bundle receipt replays and authenticates normalization rather than trusting changed JSON', async () => {
  const fixtureSpec = { ...spec, id: 'fit-fixture', size: { width: 0.8, height: 0.96, depth: 0.8 } };
  const raw = { id: fixtureSpec.id, category: 'prop', footprint: { w: 0.8, d: 0.8 }, height: 0.96, origin: 'base-center', facing: '+Z',
    parts: [
      { name: 'body', prim: 'box', size: [0.8, 0.6, 0.92], at: [0, 0.3, 0], mat: 'wood.mid', feature: 'body' },
      { name: 'top', prim: 'box', size: [0.7, 0.2, 0.805], at: [0, 0.68, 0], mat: 'timber', feature: 'top' },
      { name: 'handle', prim: 'box', size: [0.3, 0.2, 0.345], at: [0, 0.86, 0], mat: 'wood.light', feature: 'handle' },
    ], anchors: {}, collision: { type: 'box', w: 0.8, d: 0.8, h: 0.96 }, slots: {}, tags: [], emissive: [] };
  const { recipe: fitted, normalization } = fitGeneratedRecipe(raw, fixtureSpec, bible.rules, environment);
  assert.ok(normalization);
  const critique = { imageReviewed: true, scores: Object.fromEntries(['silhouette', 'palette', 'shapeLanguage', 'valueStructure', 'sceneFit', 'craft'].map((key) => [key, 4])),
    features: { body: true, top: true, handle: true }, blockers: [] };
  const receipt = (sessionID, value) => `${JSON.stringify({ type: 'text', sessionID, part: { text: JSON.stringify(value) } })}\n`;
  const receipts = { generator: receipt('gen', raw), critic: receipt('critic', critique) };
  const hashes = { recipeHash: hashText(JSON.stringify(fitted)), specHash: hashText(JSON.stringify(fixtureSpec)), bibleHash: hashText(bible.text), verifierHash: 'source' };
  const report = { status: 'PASSED', roundsUsed: 1, completedStages: bible.rules.loop.stages, best: { stage: 'optimise', normalization },
    generatorSession: 'gen', criticSession: 'critic', criticModelId: 'test/model', critique,
    generatorReceiptHash: hashText(receipts.generator), criticReceiptHash: hashText(receipts.critic), ...hashes };
  const signoff = { reviewer: 'look-dev', reportHash: hashText(JSON.stringify(report)), ...hashes };
  const input = { recipe: fitted, spec: fixtureSpec, bible, report, signoff, receipts, environment, sourceHash: 'source',
    render: async () => ({ failures: [], metrics: { unmeasured: [] } }) };
  assert.deepEqual((await auditBundleEntry(input)).failures, []);
  const altered = structuredClone(fitted); altered.parts[0].at[0] += 0.01;
  assert.ok((await auditBundleEntry({ ...input, recipe: altered })).failures.some((failure) => failure.code === 'RECEIPT'));
  const forgedReport = structuredClone(report); forgedReport.best.normalization.factors[2] += 0.01;
  assert.ok((await auditBundleEntry({ ...input, report: forgedReport })).failures.some((failure) => failure.code === 'RECEIPT'));
});
