import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deltaE76, labRGB, luminanceRGB } from '../tools/assetgen/color.js';

test('sRGB/D65 colour measurements agree with black, white and red references', () => {
  assert.ok(Math.abs(labRGB(0, 0, 0)[0]) < 1e-8);
  assert.ok(Math.abs(labRGB(255, 255, 255)[0] - 100) < 0.01);
  assert.ok(Math.abs(labRGB(255, 0, 0)[0] - 53.24) < 0.05);
  assert.equal(deltaE76([70, 120, 50], [70, 120, 50]), 0);
  assert.ok(Math.abs(deltaE76([0, 0, 0], [255, 255, 255]) - 100) < 0.01);
  assert.ok(Math.abs(luminanceRGB(255, 255, 255) - 1) < 1e-8);
});
