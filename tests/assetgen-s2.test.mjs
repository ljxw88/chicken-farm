import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyS2 } from '../tools/assetgen/visual.mjs';

const limits = { minimumSilhouettePixels: 40, minimumContrastRatio: 1.15, minimumDeltaE: 25 };
const sample = (phase, pixels = 60, meanContrastRatio = 1.1, meanDeltaE = 20) =>
  ({ phase, yaw: 45, surface: 'grass', pixels, meanContrastRatio, meanDeltaE });

test('S2 night and night-rain contrast failures are warnings only', () => {
  for (const phase of ['night', 'night-rain']) {
    const result = classifyS2(sample(phase), limits);
    assert.deepEqual(result.failures, []);
    assert.equal(result.warnings[0].code, 'S2');
    assert.match(result.warnings[0].message, /contrast/i);
  }
});

test('daytime and sunset contrast and silhouette floors remain strict on every surface', () => {
  assert.equal(classifyS2(sample('daytime'), limits).failures[0].code, 'S2');
  assert.equal(classifyS2(sample('sunset'), limits).failures[0].code, 'S2');
  for (const phase of ['daytime', 'morning', 'sunset']) for (const surface of ['grass', 'path', 'void']) {
    assert.equal(classifyS2({ ...sample(phase, 39, 1.3, 30), surface }, limits).failures[0].code, 'S2');
    assert.equal(classifyS2({ ...sample(phase, 40, 1.15, 25), surface }, limits).failures.length, 0);
  }
});

test('night keeps the grass pixel floor but warns for path and void', () => {
  const nightSize = classifyS2(sample('night', 39, 1.3, 30), limits);
  assert.equal(nightSize.failures[0].code, 'S2');
  assert.match(nightSize.failures[0].message, /pixels/i);
  assert.deepEqual(nightSize.warnings, []);
  const both = classifyS2(sample('night', 39), limits);
  assert.equal(both.failures.length, 1);
  assert.equal(both.warnings.length, 1);
  for (const phase of ['night', 'night-rain']) for (const surface of ['path', 'void']) {
    const result = classifyS2({ ...sample(phase, 39), surface }, limits);
    assert.deepEqual(result.failures, []);
    assert.equal(result.warnings.length, 2);
    assert.ok(result.warnings.every((warning) => warning.code === 'S2'));
  }
});
