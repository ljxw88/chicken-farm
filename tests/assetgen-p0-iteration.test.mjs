import assert from 'node:assert/strict';
import { test } from 'node:test';
import { improvesP0, renderP0Iteration, summarizeP0, trackP0Progress } from '../tools/assetgen/p0-iteration.mjs';

test('iteration progress never counts hard-only or missing reviews as passes', () => {
  const checks = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`H${i + 1}`, true]));
  const rows = [
    { id: 'oak', spec: { variationSeed: 42 }, recipe: { parts: [{ seed: 42, jitter: { rotation: 0.01 } }] },
      final: { status: 'needs-human', roundsUsed: 2 }, verification: { hard: { failures: [], metrics: { checks } } }, assessment: { ready: true, reasons: [] } },
    { id: 'barrel', spec: {}, final: { status: 'needs-human', roundsUsed: 3 }, verification: { hard: { failures: [], metrics: { checks } } },
      assessment: { ready: false, reasons: [{ code: 'CRITIQUE', message: 'hoops hide the body' }] } },
    { id: 'rock', spec: { variationSeed: 43 }, final: { status: 'needs-human', roundsUsed: 3 },
      verification: { hard: { failures: [{ code: 'H1', message: 'invalid jitter' }], metrics: {} } }, assessment: { ready: false, reasons: [{ code: 'H1', message: 'invalid jitter' }] } },
    { id: 'not-run', spec: {}, final: null, assessment: null },
  ];
  assert.deepEqual(summarizeP0(rows), { attempted: 3, ready: 1, hardClear: 2, schemaClear: 2, validVariantJitter: 1 });
  const report = renderP0Iteration({ rows, iteration: 1, generatedAt: 'now', runDirectory: '/evidence' });
  assert.match(report, /1 P0 candidate\(s\) clear/);
  assert.match(report, /ready for Look Dev P0 review/);
  assert.match(report, /CRITIQUE \| hoops hide the body/);
  assert.match(report, /not attempted/);
});

test('only a fully attempted iteration can improve the best progress tuple', () => {
  const baseline = { attempted: 9, ready: 0, hardClear: 2, schemaClear: 3, validVariantJitter: 0 };
  assert.equal(improvesP0({ ...baseline, attempted: 4, ready: 1 }, baseline), false);
  assert.equal(improvesP0({ ...baseline, validVariantJitter: 2 }, baseline), true);
  assert.equal(improvesP0({ ...baseline, ready: 1, hardClear: 0 }, baseline), true);
  assert.equal(improvesP0({ ...baseline, hardClear: 1, schemaClear: 9 }, baseline), true);
  assert.equal(improvesP0({ ...baseline }, baseline), false);
});

test('three consecutive full iterations without a new best stop; improvement resets the counter', () => {
  const baseline = { attempted: 9, ready: 0, hardClear: 2, schemaClear: 3, validVariantJitter: 0 };
  const better = { ...baseline, schemaClear: 5 };
  const progress = trackP0Progress(baseline, [baseline, baseline, better, better, better, better]);
  assert.equal(progress.stop, 'three-without-improvement');
  assert.equal(progress.withoutImprovement, 3);
  assert.equal(progress.history[2].withoutImprovement, 0);
  assert.equal(progress.history.length, 6);
  assert.equal(trackP0Progress(baseline, [{ ...baseline, attempted: 4, ready: 3 }]).stop, 'three-ready');
  assert.equal(trackP0Progress(baseline, [{ ...baseline, attempted: 4, ready: 0 }]).stop, 'incomplete');
});

test('a quota stop is explicit and never counted as a pass', () => {
  const rows = [{ id: 'oak', spec: {}, final: { status: 'needs-human', roundsUsed: 1, stopReason: 'Free model quota exhausted; work order emitted' },
    assessment: { ready: false, reasons: [{ code: 'NO_CANDIDATE', message: 'Free model quota exhausted' }] } }];
  const report = renderP0Iteration({ rows, iteration: 1, generatedAt: 'now', runDirectory: '/evidence', stopReason: 'provider quota exhausted' });
  assert.match(report, /0 P0 candidate\(s\) clear/);
  assert.match(report, /GENERATOR_QUOTA_429/);
  assert.match(report, /Stop: provider quota exhausted/);
});
