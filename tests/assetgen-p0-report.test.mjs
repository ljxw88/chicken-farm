import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderP0Report } from '../tools/assetgen/p0-report.mjs';

test('P0 report combines real blocker codes and does not invent missing costs', () => {
  const output = renderP0Report({ generatedAt: 'now', runDirectory: '/evidence', rows: [
    { id: 'rock-a', final: { status: 'needs-human', roundsUsed: 3, stopReason: 'Bounded correction limit reached',
      best: { blockers: [{ code: 'H3' }] }, history: [{ blockers: ['H5'] }], usage: { input: 100, output: 10, reasoning: 20, reportedCostUSD: 0 },
      visualCritiqueStatus: 'visual critique not run' }, spec: { variationSeed: 41 }, recipe: { parts: [{ seed: 41, jitter: { position: 0.01 } }] },
      verification: { hard: { failures: [{ code: 'H3' }] }, visual: 'not run' } },
    { id: 'rock-b', final: null, verification: null },
  ] });
  assert.match(output, /\| rock-a \| 3 \| needs-human \| H3, H5 \| 41 \(used\) \| 100 \/ 10 \/ 20 \| \$0\.000000/);
  assert.match(output, /\| rock-b \| 0 \| not completed \| NO_FINAL \| — \| unknown \| unknown \| not run/);
});
