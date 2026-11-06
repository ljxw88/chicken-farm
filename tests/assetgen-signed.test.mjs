import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as THREE from 'three';
import { createServer } from 'vite';
import { readBible, root } from '../tools/assetgen/config.mjs';
import { inspectSignedGroup } from '../tools/assetgen/geometry.mjs';
import { createSignedFixtures, inspectSignedFixture } from '../tools/assetgen/signed-fixtures.mjs';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createPlacementVisual } = await vite.ssrLoadModule('/src/placement/createPlacementVisual.ts');
const { createStoneStairs } = await vite.ssrLoadModule('/src/scene/createStoneStairs.ts');
const { ASSET_PALETTE } = await vite.ssrLoadModule('/src/assets/palette.ts');
const { rules } = await readBible();
after(() => vite.close());

const farm = new THREE.Scene();
createFarmLayout(farm);
const tree = farm.getObjectByName('farm-tree-2');
const coop = farm.getObjectByName('farm-ramp-coop-1');
const fence = createPlacementVisual('fence');
const tread = createStoneStairs(new THREE.Group(), 16, 2.4, 0).treads[0];
const fixtures = [
  ['tree', tree, 'flora', [2.09, 2.8, 1.7], 2.4],
  ['coop', coop, 'building', [1.7, 1.95, 2.55], 2.4],
  ['fence', fence, 'prop', [1.47, 0.95, 0.215], 0],
  ['tread', tread, 'terrain', [0.9, 2.4, 1.2], 0],
];

for (const [name, group, category, expected, ground] of fixtures) {
  test(`signed ${name} geometry remains finite, nondegenerate and within its budget`, () => {
    const report = inspectSignedGroup(group, rules, ASSET_PALETTE, category, ground);
    assert.equal(report.nonFinite, 0);
    assert.equal(report.degenerate, 0);
    assert.ok(report.triangleCount <= report.triangleBudget);
    report.bounds.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.08, `${name} bound ${index}: ${value}`));
  });
}

test('signed legacy differences are exposed rather than silently weakening recipe gates', () => {
  const fenceReport = inspectSignedGroup(fence, rules, ASSET_PALETTE, 'prop');
  const treeReport = inspectSignedGroup(tree, rules, ASSET_PALETTE, 'flora', 2.4);
  const coopReport = inspectSignedGroup(coop, rules, ASSET_PALETTE, 'building', 2.4);
  const treadReport = inspectSignedGroup(tread, rules, ASSET_PALETTE, 'terrain');
  assert.ok(fenceReport.narrowParts.length > 0, 'signed fence posts/rails predate the readable-face floor');
  assert.ok(treeReport.unsupportedMaterials.length > 0, 'signed tree has a translucent contact shadow');
  assert.ok(coopReport.narrowParts.length > 0, 'signed coop includes smaller trim and a glow pane');
  assert.ok(treeReport.zFightPairs > 0 && coopReport.zFightPairs > 0, 'signed shadow/post joins include coplanar pairs');
  assert.ok(treadReport.offPalette.length > 0, 'signed tread derives interpolated colours outside recipe tokens');
});

test('the four exact signed golden geometry fixtures pass with scoped legacy warnings', async () => {
  const signed = await createSignedFixtures(vite);
  const baseline = JSON.parse(await readFile(join(root, 'tools/assetgen/signed-baselines.json'), 'utf8'));
  for (const name of signed.names) {
    const result = inspectSignedFixture(name, signed.build(name), signed.build(name), rules, ASSET_PALETTE, baseline);
    assert.equal(result.status, 'PASS_SIGNED_GEOMETRY', `${name}: ${JSON.stringify(result.failures)}`);
    assert.deepEqual(result.failures, []);
  }
});

test('the signed path does not allow altered geometry to inherit a golden exemption', async () => {
  const signed = await createSignedFixtures(vite);
  const baseline = JSON.parse(await readFile(join(root, 'tools/assetgen/signed-baselines.json'), 'utf8'));
  const changed = signed.build('fence'); changed.children[0].position.x += 0.02;
  const result = inspectSignedFixture('fence', changed, changed.clone(true), rules, ASSET_PALETTE, baseline);
  assert.ok(result.failures.some((failure) => failure.code === 'SIGNED_CHANGED'));
});
