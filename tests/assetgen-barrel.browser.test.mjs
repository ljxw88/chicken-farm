import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readBible, root } from '../tools/assetgen/config.mjs';
import { inspectRecipe } from '../tools/assetgen/geometry.mjs';
import { createVisualRunner } from '../tools/assetgen/visual.mjs';

test('QA barrel meets strict day/sunset S2 and the night grass floor', { timeout: 120000 }, async () => {
  const { spec, recipe } = JSON.parse(await readFile(join(root, 'tests/fixtures/assetgen/qa2-barrel.fixture.json'), 'utf8'));
  const { rules } = await readBible();
  const runner = await createVisualRunner();
  try {
    const { buildRecipe } = await runner.server.ssrLoadModule('/src/assets/buildRecipe.ts');
    const { ASSET_PALETTE, ACCENT_TOKENS } = await runner.server.ssrLoadModule('/src/assets/palette.ts');
    assert.deepEqual(inspectRecipe(recipe, spec, rules, { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS }).failures, []);
    const directory = await mkdtemp(join(tmpdir(), 'assetgen-barrel-golden-'));
    const visual = await runner.capture(spec, rules, directory, recipe, { jitter: true });
    assert.ok(!visual.failures.some((failure) => ['S2', 'A7_FLICKER', 'A7_UNMEASURED', 'A9_SHADE_RATIO', 'BROWSER'].includes(failure.code)), JSON.stringify(visual.failures));
    assert.equal(visual.metrics.jitter.reduce((sum, view) => sum + view.flickerCandidates, 0), 0);
    const nightGrass = visual.metrics.samples.filter((sample) => ['night', 'night-rain'].includes(sample.phase) && sample.surface === 'grass');
    assert.ok(nightGrass.every((sample) => sample.pixels >= rules.render.minimumSilhouettePixels));
    assert.ok(visual.warnings.some((warning) => warning.code === 'S2' && /advisory night silhouette/.test(warning.message)));
  } finally { await runner.close(); }
});
