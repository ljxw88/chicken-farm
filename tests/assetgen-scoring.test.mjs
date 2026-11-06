import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBetterCandidate } from '../tools/assetgen/scoring.mjs';

test('best-of tie prefers a later equally clean stage but never a lower score', () => {
  const stages = ['blockout', 'form', 'material', 'detail'];
  const best = { score: 88, hardFailureCount: 0, lowerTrust: false, blockers: [], stage: 'blockout' };
  assert.equal(isBetterCandidate({ ...best, stage: 'material' }, best, stages), true);
  assert.equal(isBetterCandidate({ ...best, stage: 'material', score: 87 }, best, stages), false);
  assert.equal(isBetterCandidate({ ...best, stage: 'material', lowerTrust: true }, best, stages), false);
  assert.equal(isBetterCandidate({ ...best, stage: 'material', blockers: ['identity'] }, best, stages), false);
});
