import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderShowcasePage } from '../tools/assetgen/showcase-page.mjs';
import { visualCheckSummary } from '../tools/assetgen/showcase-checks.mjs';
import { diagnosticEligibility } from '../tools/assetgen/diagnostic-preview.mjs';

const frames = ['daytime', 'sunset', 'night'].flatMap((phase) => Array.from({ length: 8 }, (_, i) => `${phase}-grass-${String(i * 45).padStart(3, '0')}.png`));

test('P0 showcase marks failures, unmeasured checks and diagnostic renders honestly', () => {
  const page = renderShowcasePage({ generatedAt: '2026-11-07', overview: { available: true, included: ['rock-a'], missing: ['rock-b'] },
    assets: [{ id: 'rock-a', brief: 'A chunky rock.', status: 'needs-human', pack: { kind: 'diagnostic', files: [...frames, 'sheet.png'] },
      checks: { H1: true, H3: false }, triangles: 84, colors: ['stone'], bounds: { height: 0.4 }, rounds: 3,
      failures: [{ code: 'H3', message: 'Wrong size' }], warnings: [], unmeasured: ['Visual verification not run'], criticScores: null }] });
  assert.match(page, /P0 · SOLO REVIEW/);
  assert.match(page, /diagnostic only, not a verification pass/);
  assert.match(page, /<th>H3<\/th><td>FAIL/);
  assert.match(page, /Blocking reason:<\/strong> H3: Wrong size/);
  assert.match(page, /<th>H2<\/th><td>not measured/);
  assert.match(page, /Visual critique not run; no scores/);
  assert.match(page, /Visual verification not run/);
  assert.match(page, /rock-b/);
  assert.match(page, /data-turntable/);
  assert.match(page, /id="island-yaw"/);
  assert.match(page, /<option>night<\/option>/);
});

test('a cleared P0 candidate is labeled for Look Dev review without implying signoff', () => {
  const page = renderShowcasePage({ generatedAt: 'now', overview: { available: false }, assets: [{ id: 'barrel', status: 'needs-human',
    brief: 'A barrel.', reviewReadiness: { ready: true, reasons: [] }, checks: {}, colors: [] }] });
  assert.match(page, /ready for Look Dev P0 review/);
  assert.match(page, /Pipeline status: needs-human · not signed or bundled/);
  assert.match(page, /unmeasured checks are not passes/);
});

test('schema-invalid previews are narrow, unchanged and disclose ignored jitter', () => {
  const recipe = { parts: [{ name: 'lobe_a', jitter: { seed: 123, max: 0.02 } }] };
  const original = structuredClone(recipe), rules = { jitterMaximum: 0.03 };
  const failures = [{ code: 'H1', message: 'Invalid or duplicate part name lobe_a' },
    { code: 'H1', message: 'Part lobe_a jitter requires an integer seed' }, { code: 'VARIANT_SEED', message: 'missing seed' }];
  const result = diagnosticEligibility(recipe, failures, rules);
  assert.equal(result.safe, true);
  assert.ok(result.notes.some((note) => note.includes('ignores unsupported nested jitter')));
  assert.ok(result.notes.some((note) => note.includes('not valid kebab-case')));
  assert.deepEqual(recipe, original);
  const bounded = structuredClone(recipe); bounded.parts[0].jitter = { seed: 123, max: [0.03, 0.02, 0.03], rot: [0.03, 0.03, 0.02] };
  assert.equal(diagnosticEligibility(bounded, failures, rules).safe, true);
  bounded.parts[0].jitter.rot[1] = 0.04;
  assert.equal(diagnosticEligibility(bounded, failures, rules).safe, false);
  assert.equal(diagnosticEligibility(recipe, [...failures, { code: 'H1', message: 'Part lobe_a uses an unknown palette token' }], rules).safe, false);
  const bad = structuredClone(recipe); bad.parts[0].jitter.arbitrary = 1;
  assert.equal(diagnosticEligibility(bad, failures, rules).safe, false);
  const duplicate = structuredClone(recipe); duplicate.parts.push({ name: 'lobe_a' });
  assert.equal(diagnosticEligibility(duplicate, failures, rules).safe, false);
});

test('visual summaries do not turn missing evidence or partial checks into passes', () => {
  const unavailable = visualCheckSummary(null);
  assert.equal(unavailable.S2, 'not run');
  const partial = visualCheckSummary({ failures: [], metrics: { samples: [{}], pixel: { enabled: true, canvasWidth: 320, canvasHeight: 180, cssPixelSize: 4 } } });
  assert.equal(partial.S2, 'unmeasured');
  assert.equal(partial.S3, 'unmeasured');
  assert.equal(partial.S5, 'unmeasured');
  assert.equal(partial.PIXEL_RENDER, 'pass');
  const failing = visualCheckSummary({ failures: [{ code: 'S2' }, { code: 'A7_FLICKER' }], metrics: { samples: Array(120).fill({}) } });
  assert.equal(failing.S2, 'FAIL');
  assert.equal(failing.A7, 'FAIL');
});

test('missing evidence remains unavailable and model-provided text is escaped', () => {
  const page = renderShowcasePage({ generatedAt: 'now', overview: { available: false },
    assets: [{ id: 'missing', brief: '<script>alert(1)</script>', status: 'not generated', checks: {}, failures: [], colors: [] }] });
  assert.match(page, /Island overview unavailable/);
  assert.match(page, /Full 24-frame turntable unavailable/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
});
