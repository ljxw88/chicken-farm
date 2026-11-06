import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readBible } from '../tools/assetgen/config.mjs';
import { createVisualRunner } from '../tools/assetgen/visual.mjs';

test('real pixel renderer blocks a tagged identity feature hidden inside the body', { timeout: 120000 }, async () => {
  const { rules } = await readBible();
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-render-test-'));
  const runner = await createVisualRunner();
  const spec = { id: 'render-fixture', category: 'prop', size: { width: 0.8, depth: 0.8, height: 0.78 },
    identityFeatures: [{ id: 'body', description: 'Broad outer body' }, { id: 'cap', description: 'Visible outer cap' }, { id: 'hidden', description: 'Deliberately hidden inner part' }] };
  const recipe = { id: spec.id, category: spec.category, footprint: { w: 0.8, d: 0.8 }, height: 0.78,
    origin: 'base-center', facing: '+Z', parts: [
      { name: 'body', prim: 'box', size: [0.8, 0.6, 0.8], at: [0, 0.3, 0], mat: 'wood.mid', feature: 'body' },
      { name: 'cap', prim: 'box', size: [0.7, 0.2, 0.7], at: [0, 0.68, 0], mat: 'timber', feature: 'cap' },
      { name: 'hidden', prim: 'box', size: [0.3, 0.2, 0.3], at: [0, 0.3, 0], mat: 'plaster', feature: 'hidden' },
    ], anchors: {}, emissive: [], collision: { type: 'box', w: 0.8, d: 0.8, h: 0.78 }, slots: {}, tags: [] };
  try {
    const result = await runner.capture(spec, rules, directory, recipe);
    assert.ok(!result.failures.some((failure) => failure.code === 'BROWSER'), JSON.stringify(result.failures));
    assert.equal(result.metrics.pixel.canvasWidth, 320);
    assert.equal(result.metrics.pixel.canvasHeight, 180);
    assert.equal(result.metrics.samples.length, 72);
    assert.equal(result.metrics.frameIndex.length, 76); // 72 views, two composites, native debug, sheet.
    assert.ok(result.failures.some((failure) => failure.code === 'IDENTITY_VISIBLE' && failure.message.includes('hidden')));
    assert.ok(result.metrics.identityVisibility.hidden.every((view) => view.pixels === 0));
    assert.ok(result.metrics.identityVisibility.body.some((view) => view.pixels > 0));
    const png = await readFile(join(directory, 'sheet.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  } finally { await runner.close(); }
});
