import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderLoopBakeoff } from '../tools/assetgen/bakeoff-loop-report.mjs';

test('loop bake-off counts missing critique and unmeasured checks as no pass', () => {
  const cleanHard = { failures: [] };
  const clear = { final: { status: 'needs-human', roundsUsed: 1, best: { stage: 'blockout' }, history: [{ generatorModelId: 'opencode/test-free' }] }, elapsedMs: 2200,
    verification: { hard: cleanHard }, stageReport: { action: 'continue', hard: cleanHard, visual: { failures: [] }, critique: { imageReviewed: true }, blockers: [] } };
  const noCritic = structuredClone(clear); noCritic.stageReport.critique = null;
  const bad = { final: { status: 'needs-human', roundsUsed: 3, best: { stage: 'blockout' } }, elapsedMs: 4000,
    verification: { hard: { failures: [{ code: 'H3', message: 'wrong size' }] } }, stageReport: { action: 'refine-code', blockers: [{ code: 'H3' }] } };
  const output = renderLoopBakeoff({ generatedAt: 'now', onDirectory: '/on', offDirectory: '/off', rows: [
    { id: 'oak', on: clear, off: noCritic }, { id: 'barrel', on: bad, off: bad }, { id: 'hay', on: {}, off: {} },
  ] });
  assert.match(output, /\| ON \| 1\/3 \| 1\/3 \| 0\/3 \| 1 \|/);
  assert.match(output, /\| OFF \| 0\/3 \| 1\/3 \| 0\/3 \| 1 \|/);
  assert.match(output, /\| barrel \| ON \| needs-human \| blockout \| not clear \| H3/);
  assert.match(output, /\| hay \| OFF \| not completed \| not generated \| not clear \| not measured/);
  assert.match(output, /2\.2 s/);
  assert.match(output, /opencode\/test-free/);
  assert.match(output, /not six-stage completion, human signoff/);
});

test('a missing failed offline verification cannot be called a clear stage', () => {
  const run = { final: { status: 'needs-human', roundsUsed: 1, best: { stage: 'blockout' } }, verifyExit: 1, verification: null,
    stageReport: { action: 'continue', hard: { failures: [] }, visual: { failures: [] }, critique: { imageReviewed: true }, blockers: [] } };
  const output = renderLoopBakeoff({ generatedAt: 'now', onDirectory: '/on', offDirectory: '/off', rows: [{ id: 'barrel', on: run, off: run }] });
  assert.match(output, /\| ON \| 0\/1 \| 1\/1 \| 0\/1 \| 0 \|/);
  assert.match(output, /VERIFY_ERROR/);
});
