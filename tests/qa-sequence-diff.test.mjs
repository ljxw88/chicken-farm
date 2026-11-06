import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareQaSequences } from '../tools/compare-qa-sequences.mjs';

function run(z) {
  return {
    spawn: { pos: [0, 2.4, 0] }, walkD2s: { end: [2.186, 2.4, -2.149] },
    walkSA: { end: [2.186, 2.4, -0.106] },
    bridgeCrossing: { end: [7.6, 2.4, z], yMin: 2.4, yMax: 2.52 },
    padArrival: [12.8, 0.345, 0.76],
    stairsClimb: { end: [4.207, 2.4, 0.76], yMax: 2.4 },
    stairsDescend: { end: [13.15, 0.16, 0.76], yMin: 0.16 },
    padSide: {
      SA_then_WA: { end: [5.11, 2.4, 0.95], yMin: 0.16, yMax: 2.4 },
      WD_then_WA: { end: [4.257, 2.4, 0.55], yMin: 0.16, yMax: 2.4 },
      SD_SA_WD_then_WA: { end: [4.257, 2.4, 0.55], yMin: 0.16, yMax: 2.4 },
    },
    placement: { fenceValid: 'Fence · Ready to place', fenceOnPlayer: 'Fence · Blocked by a farm object',
      fenceOnDeck: 'Fence · Blocked by a farm object', fenceOnWater: 'Fence · Blocked by a farm object',
      fenceOnCottage: 'Fence · Blocked by a farm object', plotValid: 'Plot · Ready to place',
      placed: ['placed-fence', 'placed-plot'], afterUndo: ['placed-fence'] },
    states: {
      morning: { weather: { mode: 'clear', rainAmount: 0, cloudyAmount: 0 }, pixel: true },
      daytime: { weather: { mode: 'clear', rainAmount: 0, cloudyAmount: 0 }, pixel: true },
      sunset: { weather: { mode: 'clear', rainAmount: 0, cloudyAmount: 0 }, pixel: true },
      night: { weather: { mode: 'clear', rainAmount: 0, cloudyAmount: 0 }, pixel: true },
      'night-rain': { weather: { mode: 'rain', rainAmount: 1, cloudyAmount: 0 }, pixel: true },
      cloudy: { weather: { mode: 'cloudy', rainAmount: 0, cloudyAmount: 1 }, pixel: true },
      rain: { weather: { mode: 'rain', rainAmount: 1, cloudyAmount: 0 }, pixel: true },
    },
  };
}

test('QA trace comparison checks exact endpoints, placement and height while allowing bridge-z jitter', () => {
  const baseline = { browser: '153', sequences: { run1: run(-1.915), run2: run(-1.835) }, errors: [] };
  const candidate = structuredClone(baseline);
  candidate.sequences.run1.bridgeCrossing.end[2] = -1.76;
  assert.deepEqual(compareQaSequences(baseline, candidate).failures, []);
  candidate.sequences.run1.padSide.WD_then_WA.end[0] += 0.001;
  candidate.sequences.run2.bridgeCrossing.yMax = 2.4;
  candidate.sequences.run2.placement.afterUndo = [];
  candidate.sequences.run2.bridgeCrossing.end[2] = -1.7;
  const failures = compareQaSequences(baseline, candidate).failures.map((item) => item.name);
  assert.ok(failures.includes('run1.WD_then_WA.x'));
  assert.ok(failures.includes('run2.bridge.yMax'));
  assert.ok(failures.includes('run2.placement'));
  assert.ok(failures.includes('run2.bridge.end.z'));
});
