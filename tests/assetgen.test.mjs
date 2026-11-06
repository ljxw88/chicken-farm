import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { readBible } from '../tools/assetgen/config.mjs';
import { checkKeyLightAgreement, inspectRecipe } from '../tools/assetgen/geometry.mjs';

const server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
const { buildRecipe, setRecipeNightAmount } = await server.ssrLoadModule('/src/assets/buildRecipe.ts');
const { ASSET_PALETTE, ACCENT_TOKENS } = await server.ssrLoadModule('/src/assets/palette.ts');
const { rules } = await readBible();
after(() => server.close());
const environment = { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS };

const spec = {
  id: 'fixture', category: 'prop', size: { width: 0.8, depth: 0.8, height: 0.96 },
  identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'cap', description: 'A broad cap' }, { id: 'top', description: 'A raised top' }],
};
const valid = {
  id: 'fixture', category: 'prop', footprint: { w: 0.8, d: 0.8 }, height: 0.96,
  origin: 'base-center', facing: '+Z',
  parts: [
    { name: 'body', prim: 'box', size: [0.8, 0.6, 0.8], at: [0, 0.3, 0], mat: 'wood.mid', feature: 'body' },
    { name: 'cap', prim: 'box', size: [0.7, 0.2, 0.7], at: [0, 0.68, 0], mat: 'timber', feature: 'cap' },
    { name: 'top', prim: 'box', size: [0.3, 0.2, 0.3], at: [0, 0.86, 0], mat: 'wood.light', feature: 'top' },
  ],
  anchors: {}, collision: { type: 'box', w: 0.8, d: 0.8, h: 0.96 }, slots: {}, tags: [], emissive: [],
};
const clone = () => structuredClone(valid);
const check = (recipe) => inspectRecipe(recipe, spec, rules, environment);
const expectCode = (recipe, code) => {
  const result = check(recipe);
  assert.ok(result.failures.some((failure) => failure.code === code), `expected ${code}: ${JSON.stringify(result.failures)}`);
  return result;
};

test('a connected, centred, palette-only recipe passes all hard checks', () => {
  const result = check(clone());
  assert.deepEqual(result.failures, []);
  assert.ok(Object.values(result.metrics.checks).every((passed) => passed === true));
  assert.equal(result.metrics.geometryHashes[0], result.metrics.geometryHashes[1]);
});

test('off-palette raw colour is rejected as H1', () => {
  const recipe = clone(); recipe.parts[0].mat = '#ff00ff'; expectCode(recipe, 'H1');
});

test('a 5000-triangle blob is rejected as H2 and expensive checks are not falsely passed', () => {
  const recipe = clone();
  recipe.parts.push({ name: 'blob', prim: 'custom', mat: 'wood.mid', at: [0, 0, 0],
    positions: [0, 0, 0, 0.6, 0, 0, 0, 0.6, 0], indices: Array.from({ length: 15000 }, (_, i) => i % 3) });
  const result = expectCode(recipe, 'H2');
  assert.equal(result.metrics.checks.H7, 'not-run');
  assert.equal(result.metrics.lowerTrust, true);
});

test('0.05-wide plank fails H5', () => {
  const recipe = clone(); recipe.parts[2].size = [0.05, 0.2, 0.3]; expectCode(recipe, 'H5');
});

test('a wide hollow hoop with a hairline wall still fails H5', () => {
  const recipe = clone();
  recipe.parts[2] = { name: 'hoop', prim: 'lathe', profile: [[0.3, -0.05], [0.31, -0.05], [0.31, 0.05], [0.3, 0.05]],
    segments: 8, at: [0, 0.82, 0], mat: 'timber', feature: 'top', exception: 'band' };
  expectCode(recipe, 'H5');
});

test('a one-unit origin offset fails H4', () => {
  const recipe = clone(); for (const part of recipe.parts) part.at[0] += 1; expectCode(recipe, 'H4');
});

test('a disconnected floating part fails H8', () => {
  const recipe = clone(); recipe.parts[2].at[1] += 2; expectCode(recipe, 'H8');
});

test('near-coplanar overlapping faces fail H7, not mere edge contact', () => {
  const recipe = clone(); recipe.parts.push({ ...structuredClone(recipe.parts[0]), name: 'duplicate' }); expectCode(recipe, 'H7');
});

test('two differently triangulated quads 0.004 units apart fail H7', () => {
  const recipe = clone();
  const positions = [-0.3, 0.15, 0, 0.3, 0.15, 0, 0.3, 0.45, 0, -0.3, 0.45, 0];
  recipe.parts.push({ name: 'quad-a', prim: 'custom', positions, indices: [0, 1, 2, 0, 2, 3], at: [0, 0, 0.41], mat: 'timber' });
  recipe.parts.push({ name: 'quad-b', prim: 'custom', positions, indices: [0, 1, 3, 1, 2, 3], at: [0, 0, 0.414], mat: 'timber' });
  const result = expectCode(recipe, 'H7');
  assert.ok(result.failures.some((failure) => failure.code === 'H7' && failure.message.includes('quad-a') && failure.message.includes('quad-b')));
});

test('non-finite geometry is rejected before execution', () => {
  const recipe = clone(); recipe.parts[0].at[0] = NaN; expectCode(recipe, 'H1');
});

test('below-ground geometry fails H9', () => {
  const recipe = clone(); recipe.parts[0].at[1] -= 0.1; expectCode(recipe, 'H9');
});

test('tenfold size fails H3', () => {
  const recipe = clone();
  for (const part of recipe.parts) { part.at = part.at.map((value) => value * 10); part.size = part.size.map((value) => value * 10); }
  expectCode(recipe, 'H3');
});

test('a key-facing face darker than the opposing face fails S4', () => {
  const result = checkKeyLightAgreement([
    { normal: [1, 0, 0], luminance: 0.2, albedo: 0.5 },
    { normal: [-1, 0, 0], luminance: 0.4, albedo: 0.5 },
  ], [1, 0, 0]);
  assert.equal(result.code, 'S4');
  assert.equal(result.status, 'fail');
});

test('missing identity tags fail even if other metrics pass', () => {
  const recipe = clone(); delete recipe.parts[2].feature; expectCode(recipe, 'IDENTITY');
});

test('unapproved tokens and multiple accents fail closed', () => {
  const recipe = clone(); recipe.proposedTokens = ['wool']; expectCode(recipe, 'H1');
  const accents = clone(); accents.parts[0].mat = 'flower.blue'; accents.parts[1].mat = 'flower.yellow'; expectCode(accents, 'H1');
});

test('nondeterministic geometry fails H6 and an oversized collision box fails H10', () => {
  let calls = 0;
  const result = inspectRecipe(clone(), spec, rules, { ...environment, buildRecipe(recipe) {
    const group = buildRecipe(recipe); group.children[0].position.x += calls++ * 0.01; return group;
  } });
  assert.ok(result.failures.some((failure) => failure.code === 'H6'));
  const recipe = clone(); recipe.collision.w = 2; expectCode(recipe, 'H10');
});

test('declared emissive materials start dark, ramp explicitly, and add no lights', () => {
  const recipe = clone(); recipe.emissive = [{ part: 'top', mat: 'lantern', strength: 0.7 }];
  const group = buildRecipe(recipe);
  const top = group.getObjectByName('top');
  assert.equal(top.material.emissiveIntensity, 0);
  setRecipeNightAmount(group, 0.5);
  assert.equal(top.material.emissiveIntensity, 0.35);
  let lights = 0; group.traverse((object) => { if (object.isLight) lights++; });
  assert.equal(lights, 0);
});

test('closed primitive builders produce finite nondegenerate geometry', () => {
  const variants = [
    { prim: 'box', size: [0.6, 0.6, 0.6] },
    { prim: 'bevelBox', size: [0.6, 0.6, 0.6], bevel: 0.05 },
    { prim: 'cylinder', radiusTop: 0.3, radiusBottom: 0.25, h: 0.6, segments: 8 },
    { prim: 'cone', radius: 0.3, h: 0.6, segments: 8 },
    { prim: 'sphere', radius: 0.3, detail: 1 },
    { prim: 'capsule', radius: 0.3, length: 0.3, segments: 8 },
    { prim: 'wedge', size: [0.6, 0.6, 0.6] },
    { prim: 'lathe', profile: [[0, -0.3], [0.25, -0.3], [0.3, 0], [0.25, 0.3], [0, 0.3]], segments: 8 },
    { prim: 'extrude', polygon: [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], depth: 0.6 },
  ];
  for (const variant of variants) {
    const recipe = clone();
    recipe.parts = [{ name: 'body', mat: 'wood.mid', at: [0, 0.4, 0], feature: 'body', ...variant }];
    const result = check(recipe);
    assert.ok(!result.failures.some((failure) => ['G_NON_FINITE', 'G_DEGENERATE', 'G_NORMALS', 'BUILD'].includes(failure.code)),
      `${variant.prim}: ${JSON.stringify(result.failures)}`);
  }
});
