import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readBible, root } from '../tools/assetgen/config.mjs';
import { inspectRecipe } from '../tools/assetgen/geometry.mjs';
import { createVisualRunner } from '../tools/assetgen/visual.mjs';

test('fixed QA hay bale clears H1–H10 and all 24 unchanged A7 jitter views', { timeout: 120000 }, async () => {
  const { spec, recipe } = JSON.parse(await readFile(join(root, 'tests/fixtures/assetgen/g3-hay-bale.fixture.json'), 'utf8'));
  const { rules } = await readBible();
  const runner = await createVisualRunner();
  try {
    const { buildRecipe } = await runner.server.ssrLoadModule('/src/assets/buildRecipe.ts');
    const { ASSET_PALETTE, ACCENT_TOKENS } = await runner.server.ssrLoadModule('/src/assets/palette.ts');
    const hard = inspectRecipe(recipe, spec, rules, { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS });
    assert.deepEqual(hard.failures, []);
    const directory = await mkdtemp(join(tmpdir(), 'assetgen-hay-golden-'));
    const original = structuredClone(recipe);
    original.parts[0].size[1] = 0.5;
    original.parts[0].at[1] = 0.25;
    const before = await runner.capture(spec, rules, join(directory, 'original'), original, { jitter: true });
    assert.ok(before.failures.some((failure) => failure.code === 'A7_FLICKER'), JSON.stringify(before.metrics.jitter));
    assert.equal(before.metrics.jitter.reduce((sum, view) => sum + view.flickerCandidates, 0), 1);
    const visual = await runner.capture(spec, rules, join(directory, 'fixed'), recipe, { jitter: true });
    assert.ok(!visual.failures.some((failure) => ['BROWSER', 'A7_FLICKER', 'A7_UNMEASURED'].includes(failure.code)), JSON.stringify(visual.failures));
    assert.equal(visual.metrics.jitter.length, 24);
    assert.ok(visual.metrics.jitter.every((view) => view.flickerCandidates === 0));
    assert.ok(visual.metrics.jitter.some((view) => view.checkedPixels > 0));
    assert.equal(visual.metrics.a9FloorMode, 'calibrated');
    const calibration = visual.metrics.a9Calibration;
    for (const phase of ['daytime', 'morning', 'sunset']) {
      assert.equal(calibration.floors[phase], Math.min(...['coop', 'fence', 'tread'].map((name) => calibration.measurements[name][phase])));
    }
  } finally { await runner.close(); }
});
