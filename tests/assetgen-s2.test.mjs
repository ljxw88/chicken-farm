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

test('daytime contrast and the silhouette pixel floor remain strict', () => {
  assert.equal(classifyS2(sample('daytime'), limits).failures[0].code, 'S2');
  assert.equal(classifyS2(sample('sunset'), limits).failures[0].code, 'S2');
  const nightSize = classifyS2(sample('night', 39, 1.3, 30), limits);
  assert.equal(nightSize.failures[0].code, 'S2');
  assert.match(nightSize.failures[0].message, /pixels/i);
  assert.deepEqual(nightSize.warnings, []);
  const both = classifyS2(sample('night', 39), limits);
  assert.equal(both.failures.length, 1);
  assert.equal(both.warnings.length, 1);
});
