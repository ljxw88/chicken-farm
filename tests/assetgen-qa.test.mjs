import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';
import { readBible, root } from '../tools/assetgen/config.mjs';
import { inspectRecipe } from '../tools/assetgen/geometry.mjs';
import { auditBundleEntry, hashRecipe, hashText, verifierSourceHash } from '../tools/assetgen/bundle.mjs';
import { calibrationDigestPath, calibrationPath } from '../tools/assetgen/a9-calibration.mjs';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
const { buildRecipe } = await vite.ssrLoadModule('/src/assets/buildRecipe.ts');
const { ASSET_PALETTE, ACCENT_TOKENS } = await vite.ssrLoadModule('/src/assets/palette.ts');
const bible = await readBible();
const { rules } = bible;
after(() => vite.close());
const environment = { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS };
const spec = { id: 'qa-fixture', category: 'prop', brief: 'A sturdy box-shaped fixture with three visible features.',
  size: { width: 0.8, depth: 0.8, height: 0.96 }, paletteHints: ['wood.mid'], referenceAssetIds: ['signed-fence'],
  identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'cap', description: 'A broad cap' }, { id: 'top', description: 'A raised top' }] };
const recipe = { id: spec.id, category: spec.category, footprint: { w: 0.8, d: 0.8 }, height: 0.96, origin: 'base-center', facing: '+Z',
  parts: [
    { name: 'body', prim: 'box', size: [0.8, 0.6, 0.8], at: [0, 0.3, 0], mat: 'wood.mid', feature: 'body' },
    { name: 'cap', prim: 'box', size: [0.7, 0.2, 0.7], at: [0, 0.68, 0], mat: 'timber', feature: 'cap' },
    { name: 'top', prim: 'box', size: [0.3, 0.2, 0.3], at: [0, 0.86, 0], mat: 'wood.light', feature: 'top' },
  ], anchors: {}, emissive: [], collision: { type: 'box', w: 0.8, d: 0.8, h: 0.96 }, slots: {}, tags: [] };
const copy = () => structuredClone(recipe);
const inspect = (r, s = spec, e = environment) => inspectRecipe(r, s, rules, e);
function mustFail(r, code, s = spec, e = environment) {
  const result = inspect(r, s, e);
  assert.ok(result.failures.some((failure) => failure.code === code), `expected ${code}: ${JSON.stringify(result.failures)}`);
  return result;
}
const injected = (change) => ({ ...environment, buildRecipe(r) { const group = buildRecipe(r); change(group); return group; } });

test('QA baseline recipe passes independently specified hard checks', () => assert.deepEqual(inspect(copy()).failures, []));
test('PM four-round cap, no-wool scope and 6–8 segment rule are enforced', () => {
  assert.equal(rules.loop.maxRounds, 4);
  assert.equal(Object.hasOwn(ASSET_PALETTE, 'wool'), false);
  const r = copy();
  r.parts[0] = { name: 'body', prim: 'cylinder', radiusTop: 0.3, radiusBottom: 0.3, h: 0.6, segments: 9,
    at: [0, 0.3, 0], mat: 'wood.mid', feature: 'body' };
  const result = mustFail(r, 'H1');
  assert.ok(result.failures.some((failure) => failure.message.includes('6–8 segments')));
});
test('B1 raw hex is rejected by palette', () => { const r = copy(); r.parts[0].mat = '#ff00ff'; mustFail(r, 'H1'); });
test('B2 black, white and off-palette built materials are rejected', () => {
  for (const color of [0x000000, 0xffffff, 0xff00ff]) mustFail(copy(), 'H1', spec, injected((g) => {
    g.children[0].material = g.children[0].material.clone(); g.children[0].material.color.setHex(color);
  }));
  const wrongUse = copy(); wrongUse.parts[0].mat = 'flower.blue'; mustFail(wrongUse, 'H1');
});
test('B3 5000-triangle blob fails budget', () => { const r = copy(); r.parts.push({ name: 'blob', prim: 'custom', mat: 'wood.mid', at: [0, 0, 0], positions: [0, 0, 0, 0.6, 0, 0, 0, 0.6, 0], indices: Array.from({ length: 15000 }, (_, i) => i % 3) }); mustFail(r, 'H2'); });
test('B4 0.05 plank fails minimum feature size', () => { const r = copy(); r.parts[2].name = 'plank'; r.parts[2].size = [0.05, 0.2, 0.3]; mustFail(r, 'H5'); });
test('B5 0.15 handle fails must-read size', () => { const r = copy(); r.parts[2].name = 'handle'; r.parts[2].size = [0.15, 0.15, 0.6]; mustFail(r, 'H5'); });
test('B6 centre-origin geometry fails the base-origin rule', () => { const r = copy(); for (const part of r.parts) part.at[1] -= 0.48; mustFail(r, 'H4'); });
test('B7 -Z facing fails the declared-facing rule', () => { const r = copy(); r.facing = '-Z'; mustFail(r, 'H4'); });
test('base-centre tolerance accepts under 15% and rejects above 15%', () => {
  const near = copy(); for (const part of near.parts) part.at[0] += 0.11;
  assert.ok(!inspect(near).failures.some((failure) => failure.code === 'H4'));
  const far = copy(); for (const part of far.parts) part.at[0] += 0.13;
  mustFail(far, 'H4');
});
test('B8 floating part fails connectivity', () => { const r = copy(); r.parts[2].at[1] += 0.2; mustFail(r, 'H8'); });
test('B9 buried part fails below-ground', () => { const r = copy(); r.parts[0].at[1] -= 0.03; mustFail(r, 'H9'); });
test('B10 overlapping coplanar faces fail the new-recipe z-fight gate', () => { const r = copy(); r.parts.push({ ...structuredClone(r.parts[0]), name: 'duplicate' }); mustFail(r, 'H7'); });
test('polygon offset cannot conceal overlapping coplanar geometry', () => { const r = copy(); r.parts.push({ ...structuredClone(r.parts[0]), name: 'duplicate', polygonOffset: true }); mustFail(r, 'H7'); });
test('B11 NaN and degenerate triangles fail geometry validity', () => {
  const nan = copy(); nan.parts[0].size[0] = NaN; mustFail(nan, 'G_NON_FINITE');
  const flat = copy(); flat.parts.push({ name: 'degenerate', prim: 'custom', mat: 'wood.mid', at: [0, 0.1, 0], positions: [0, 0, 0, 0.2, 0, 0, 0.4, 0, 0], indices: [0, 1, 2] }); mustFail(flat, 'G_DEGENERATE');
});
test('B12 both tenfold and tenth-scale geometry fail size', () => {
  for (const factor of [10, 0.1]) { const r = copy(); for (const part of r.parts) { part.at = part.at.map((v) => v * factor); part.size = part.size.map((v) => v * factor); } mustFail(r, 'H3'); }
});
test('B13 emissive body and vertex-colour baked light are rejected', () => {
  const r = copy(); r.emissive.push({ part: 'body', mat: 'wood.mid', strength: 1 }); mustFail(r, 'BAKED_LIGHT');
  const painted = copy(); painted.parts[1].name = 'baked-shadow'; mustFail(painted, 'BAKED_LIGHT');
  mustFail(copy(), 'BAKED_LIGHT', spec, injected((g) => { const m = g.children[0]; m.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(m.geometry.getAttribute('position').count * 3).fill(0.2), 3)); m.material = m.material.clone(); m.material.vertexColors = true; }));
  mustFail(copy(), 'BAKED_LIGHT', spec, injected((g) => { g.children[0].material = g.children[0].material.clone(); g.children[0].material.onBeforeCompile = () => {}; }));
});
test('declared lantern-post glass is the sole permitted night emissive', () => {
  const lanternSpec = { ...spec, id: 'lantern-post', brief: 'A lantern post with a clearly visible glass panel.' };
  const r = copy(); r.id = lanternSpec.id; r.parts[2].name = 'lantern-glass'; r.parts[2].mat = 'lantern.glow';
  r.emissive.push({ part: 'lantern-glass', mat: 'lantern.glow', strength: 0.5 });
  assert.deepEqual(inspect(r, lanternSpec).failures, []);
});

test('a material family cannot use more than three albedo tones', () => {
  const r = copy();
  r.parts.push({ name: 'extra-tone', prim: 'box', size: [0.3, 0.2, 0.3], at: [0, 0.86, 0], mat: 'door' });
  const result = mustFail(r, 'H1');
  assert.ok(result.failures.some((item) => item.message.includes('more than three albedo tones')));
});
test('B14 PointLight, texture, transparency and text are rejected', () => {
  mustFail(copy(), 'FORBIDDEN_FEATURE', spec, injected((g) => g.add(new THREE.PointLight(0xffffff))));
  mustFail(copy(), 'FORBIDDEN_FEATURE', spec, injected((g) => { g.children[0].material = g.children[0].material.clone(); g.children[0].material.map = new THREE.Texture(); }));
  mustFail(copy(), 'FORBIDDEN_FEATURE', spec, injected((g) => { g.children[0].material = g.children[0].material.clone(); g.children[0].material.transparent = true; g.children[0].material.opacity = 0.5; }));
  const r = copy(); r.parts[0].prim = 'text'; mustFail(r, 'FORBIDDEN_FEATURE');
});
test('B15 nondeterministic builder fails the two-build hash', () => {
  let n = 0; mustFail(copy(), 'H6', spec, injected((g) => { g.children[0].position.x += n++ * 0.02; }));
});
test('B16 obvious smooth-tree, spiky-rock and off-palette anti-examples fail', () => {
  const treeSpec = { ...spec, id: 'smooth-tree', category: 'flora', brief: 'A round oak tree with a single smooth spherical crown.' };
  const tree = copy(); tree.id = treeSpec.id; tree.category = treeSpec.category; tree.parts[0].prim = 'sphere'; delete tree.parts[0].size; tree.parts[0].radius = 0.4; tree.parts[0].detail = 1; tree.parts[0].mat = 'foliage.mid'; mustFail(tree, 'STYLE_TREE', treeSpec);
  const rockSpec = { ...spec, id: 'spiky-rock', category: 'terrain', brief: 'A rock covered with sharp spikes.' };
  const rock = copy(); rock.id = rockSpec.id; rock.category = rockSpec.category; rock.parts[2] = { name: 'spike', prim: 'cone', radius: 0.1, h: 0.6, segments: 6, at: [0, 0.9, 0], mat: 'stone', feature: 'top' }; mustFail(rock, 'STYLE_SPIKY', rockSpec);
  const barrel = copy(); barrel.parts[0].mat = '#e000ff'; mustFail(barrel, 'H1');
});
test('B17 a recolour-only or uniformly rescaled variant is rejected', () => {
  const variant = copy(); variant.parts[0].mat = 'dirt.hi';
  const s = { ...spec, variantOf: 'original' };
  mustFail(variant, 'VARIANT_RECOLOR', s, { ...environment, referenceRecipes: { original: recipe } });
  const scaled = copy(); scaled.height *= 1.02; for (const part of scaled.parts) { part.at = part.at.map((n) => n * 1.02); part.size = part.size.map((n) => n * 1.02); }
  mustFail(scaled, 'VARIANT_RECOLOR', s, { ...environment, referenceRecipes: { original: recipe } });
  const disguised = copy(); for (const part of disguised.parts) { part.at = part.at.map((n) => n * 1.02); part.size = part.size.map((n) => n * 1.02); }
  mustFail(disguised, 'VARIANT_RECOLOR', s, { ...environment, referenceRecipes: { original: recipe } });
});
test('B18 oversized collision box fails coverage, even with disguised area', () => {
  const r = copy(); r.collision.w = 4; mustFail(r, 'H10');
  const disguised = copy(); disguised.collision.w *= 2; disguised.collision.d /= 2; mustFail(disguised, 'H10');
});

test('fooling attempts: threshold edge, hidden sliver, invisible geometry and group transform', () => {
  for (const width of [0.09, 0.11]) {
    const r = copy(); r.parts.push({ name: 'floating-plank', prim: 'box', size: [width, 0.14, 0.4], at: [0, 1.4, 0], mat: 'timber' });
    const result = mustFail(r, 'H8');
    assert.equal(result.failures.some((f) => f.code === 'H5' && f.message.includes('floating-plank')), width < 0.1);
  }
  const sliver = copy(); sliver.parts.push({ name: 'hidden-sliver', prim: 'box', size: [0.02, 0.3, 0.3], at: [0, 0.3, 0], mat: 'timber' }); mustFail(sliver, 'H5');
  mustFail(copy(), 'G_HIDDEN', spec, injected((g) => { g.children[0].visible = false; }));
  mustFail(copy(), 'G_ZERO_SCALE', spec, injected((g) => { g.children[0].scale.set(0, 0, 0); }));
  const invisible = copy(); invisible.parts[0].visible = false; mustFail(invisible, 'G_HIDDEN');
  const zero = copy(); zero.parts[0].scale = [0, 1, 1]; mustFail(zero, 'G_ZERO_SCALE');
  mustFail(copy(), 'H4', spec, injected((g) => { g.scale.setScalar(100); }));
  mustFail(copy(), 'H3', spec, injected((g) => { g.scale.setScalar(100); }));
  mustFail(copy(), 'H4', spec, injected((g) => { g.scale.setScalar(0.01); g.children[0].position.x = 80; }));
  const hiddenBlob = copy(); hiddenBlob.parts.push({ name: 'blob', prim: 'custom', mat: 'wood.mid', at: [0, 0, 0],
    positions: [0, 0, 0, 0.6, 0, 0, 0, 0.6, 0], indices: Array.from({ length: 15000 }, (_, i) => i % 3) });
  const result = mustFail(hiddenBlob, 'H2', spec, injected((g) => { g.getObjectByName('blob').visible = false; }));
  assert.ok(result.failures.some((failure) => failure.code === 'G_HIDDEN'));
});

test('QA can verify one external fixture without modifying its folder', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-qa-fixtures-'));
  const target = join(directory, spec.id);
  await mkdir(target);
  const invalid = copy(); invalid.parts[0].mat = '#fa00fa';
  const specText = JSON.stringify(spec), recipeText = JSON.stringify(invalid);
  await writeFile(join(target, 'spec.json'), specText);
  await writeFile(join(target, 'recipe.json'), recipeText);
  try {
    let output = '';
    try { execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'verify', '--dir', directory, '--id', spec.id], { cwd: root, encoding: 'utf8', timeout: 70000 }); }
    catch (error) { output = error.stdout; assert.notEqual(error.status, 0); }
    assert.match(output, /"code": "H1"/);
    assert.match(output, /palette token/);
    assert.match(output, /"a9Calibration"/);
    assert.match(output, /"floors"/);
    assert.equal(await readFile(join(target, 'spec.json'), 'utf8'), specText);
    assert.equal(await readFile(join(target, 'recipe.json'), 'utf8'), recipeText);
  } finally {
    await unlink(join(target, 'spec.json')); await unlink(join(target, 'recipe.json'));
    await rmdir(target); await rmdir(directory);
  }
});

test('bundle recomputes checks and rejects stale hashes, needs-human and forged PASS reports', async () => {
  const sourceHash = 'test-verifier-hash';
  const hashes = { recipeHash: hashRecipe(recipe), specHash: hashRecipe(spec), bibleHash: hashText(bible.text), verifierHash: sourceHash };
  const critique = { imageReviewed: true, scores: { silhouette: 4, palette: 4, shapeLanguage: 4, valueStructure: 4, sceneFit: 4, craft: 4 },
    features: { body: true, cap: true, top: true }, blockers: [] };
  const makeReceipt = (sessionID, value) => `${JSON.stringify({ type: 'step_start', sessionID })}\n${JSON.stringify({ type: 'text', sessionID, part: { text: JSON.stringify(value) } })}\n`;
  const receipts = { generator: makeReceipt('generator', recipe), critic: makeReceipt('critic', critique) };
  const report = { status: 'PASSED', roundsUsed: 1, completedStages: rules.loop.stages, best: { stage: 'optimise' },
    generatorSession: 'generator', criticSession: 'critic', criticModelId: 'test/model', critique,
    generatorReceiptHash: hashText(receipts.generator), criticReceiptHash: hashText(receipts.critic), ...hashes };
  const signoff = { reviewer: 'look-dev', ...hashes, reportHash: hashText(JSON.stringify(report)) };
  const input = { recipe: copy(), spec, bible, report, signoff, receipts, environment, sourceHash,
    render: async () => ({ failures: [], metrics: { unmeasured: [] } }) };
  assert.equal((await auditBundleEntry(input)).status, 'PASSED'); // Synthetic signoff, never a real art approval.
  const changed = copy(); changed.parts[0].size[0] += 0.01;
  assert.ok((await auditBundleEntry({ ...input, recipe: changed })).failures.some((f) => f.code === 'HASH_MISMATCH'));
  assert.ok((await auditBundleEntry({ ...input, bible: { ...bible, text: `${bible.text}changed` } })).failures.some((f) => f.code === 'HASH_MISMATCH'));
  assert.ok((await auditBundleEntry({ ...input, recipeBytes: `${JSON.stringify(recipe)} ` })).failures.some((f) => f.code === 'HASH_MISMATCH'));
  assert.ok((await auditBundleEntry({ ...input, specBytes: `${JSON.stringify(spec)}\n` })).failures.some((f) => f.code === 'HASH_MISMATCH'));
  assert.ok((await auditBundleEntry({ ...input, report: { ...report, status: 'needs-human' } })).failures.some((f) => f.code === 'STATUS'));
  assert.ok((await auditBundleEntry({ ...input, report: { ...report, roundsUsed: 4 } })).failures.some((f) => f.code === 'STATUS'));
  const bad = copy(); bad.parts[0].mat = '#ff00ff';
  const forged = { ...report, recipeHash: hashRecipe(bad) };
  const forgedSignoff = { ...signoff, recipeHash: hashRecipe(bad), reportHash: hashText(JSON.stringify(forged)) };
  assert.ok((await auditBundleEntry({ ...input, recipe: bad, report: forged, signoff: forgedSignoff })).failures.some((f) => f.code === 'H1'));
  assert.ok((await auditBundleEntry({ ...input, signoff: null })).failures.some((f) => f.code === 'SIGNOFF'));
  assert.ok((await auditBundleEntry({ ...input, receipts: { ...receipts, critic: `${receipts.critic} ` } })).failures.some((f) => f.code === 'RECEIPT'));
});

test('editing calibration and its digest invalidates the original bundle receipt', async () => {
  const sourceHash = await verifierSourceHash();
  const forged = JSON.parse(await readFile(calibrationPath, 'utf8'));
  forged.measurements.tread.daytime = 0.0001;
  forged.floors.daytime = 0.0001;
  const changedTable = `${JSON.stringify(forged, null, 2)}\n`;
  const changedHash = await verifierSourceHash({ readSource: async (path, encoding) => path === calibrationPath ? changedTable
    : path === calibrationDigestPath ? `${hashText(changedTable)}\n` : readFile(path, encoding) });
  assert.notEqual(changedHash, sourceHash);
  const hashes = { recipeHash: hashRecipe(recipe), specHash: hashRecipe(spec), bibleHash: hashText(bible.text), verifierHash: sourceHash };
  const critique = { imageReviewed: true, blockers: [], features: { body: true, cap: true, top: true },
    scores: { silhouette: 4, palette: 4, shapeLanguage: 4, valueStructure: 4, sceneFit: 4, craft: 4 } };
  const makeReceipt = (sessionID, value) => `${JSON.stringify({ type: 'step_start', sessionID })}\n${JSON.stringify({ type: 'text', sessionID, part: { text: JSON.stringify(value) } })}\n`;
  const receipts = { generator: makeReceipt('generator', recipe), critic: makeReceipt('critic', critique) };
  const report = { status: 'PASSED', roundsUsed: 1, completedStages: rules.loop.stages, best: { stage: 'optimise' },
    generatorSession: 'generator', criticSession: 'critic', criticModelId: 'test/model', critique,
    generatorReceiptHash: hashText(receipts.generator), criticReceiptHash: hashText(receipts.critic), ...hashes };
  const signoff = { reviewer: 'look-dev', ...hashes, reportHash: hashText(JSON.stringify(report)) };
  const input = { recipe: copy(), spec, bible, report, signoff, receipts, environment, sourceHash,
    render: async () => ({ failures: [], metrics: { unmeasured: [] } }) };
  assert.equal((await auditBundleEntry(input)).status, 'PASSED');
  const tampered = await auditBundleEntry({ ...input, sourceHash: changedHash });
  assert.ok(tampered.failures.some((failure) => failure.code === 'HASH_MISMATCH' && failure.message.includes('verifierHash')));
});

test('bundle CLI refuses a forged PASS even with matching hashes and signoff fixture', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-forged-bundle-'));
  const target = join(directory, spec.id); await mkdir(target);
  const invalid = copy(); invalid.parts[0].mat = '#ff00ff';
  const hashes = { recipeHash: hashRecipe(invalid), specHash: hashRecipe(spec), bibleHash: hashText(bible.text), verifierHash: await verifierSourceHash() };
  const report = { status: 'PASSED', roundsUsed: 1, completedStages: rules.loop.stages, best: { stage: 'optimise' },
    generatorSession: 'generator', criticSession: 'critic', criticModelId: 'test/model', ...hashes,
    critique: { imageReviewed: true, blockers: [], features: { body: true, cap: true, top: true },
      scores: { silhouette: 4, palette: 4, shapeLanguage: 4, valueStructure: 4, sceneFit: 4, craft: 4 } } };
  const files = { 'spec.json': spec, 'recipe.json': invalid, 'report.json': report, 'signoff.json': { reviewer: 'look-dev', ...hashes, reportHash: hashText(JSON.stringify(report)) } };
  for (const [name, content] of Object.entries(files)) await writeFile(join(target, name), JSON.stringify(content));
  try {
    let output = '';
    try { execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'bundle', '--dir', directory], { cwd: root, encoding: 'utf8', timeout: 70000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { output = error.stdout; assert.notEqual(error.status, 0); }
    assert.match(output, /"code": "H1"/);
    assert.match(output, /REJECTED/);
  } finally {
    for (const name of Object.keys(files)) await unlink(join(target, name));
    await rmdir(target); await rmdir(directory);
  }
});

test('bundle CLI rejects a whitespace-only source-byte change', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-byte-bundle-'));
  const target = join(directory, spec.id); await mkdir(target);
  const specText = JSON.stringify(spec), recipeText = JSON.stringify(recipe);
  const hashes = { recipeHash: hashText(recipeText), specHash: hashText(specText), bibleHash: hashText(bible.text), verifierHash: await verifierSourceHash() };
  const report = { status: 'PASSED', roundsUsed: 1, completedStages: rules.loop.stages, best: { stage: 'optimise' },
    generatorSession: 'generator', criticSession: 'critic', criticModelId: 'test/model', ...hashes,
    critique: { imageReviewed: true, blockers: [], features: { body: true, cap: true, top: true },
      scores: { silhouette: 4, palette: 4, shapeLanguage: 4, valueStructure: 4, sceneFit: 4, craft: 4 } } };
  const files = { 'spec.json': specText, 'recipe.json': `${recipeText} `, 'report.json': JSON.stringify(report),
    'signoff.json': JSON.stringify({ reviewer: 'look-dev', ...hashes, reportHash: hashText(JSON.stringify(report)) }) };
  for (const [name, content] of Object.entries(files)) await writeFile(join(target, name), content);
  try {
    let output = '';
    try { execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'bundle', '--dir', directory], { cwd: root, encoding: 'utf8', timeout: 70000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { output = error.stdout; assert.notEqual(error.status, 0); }
    assert.match(output, /HASH_MISMATCH/);
    assert.equal(await readFile(join(target, 'recipe.json'), 'utf8'), `${recipeText} `);
  } finally {
    for (const name of Object.keys(files)) await unlink(join(target, name));
    await rmdir(target); await rmdir(directory);
  }
});
