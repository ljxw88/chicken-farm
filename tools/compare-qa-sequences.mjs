import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// QA's main 9e8c8c6 checkpoints, rounded to the precision of sequences.json.
const checkpoints = {
  spawn: [0, 2.4, 0], walkD2s: [2.186, 2.4, -2.149], walkSA: [2.186, 2.4, -0.106],
  padArrival: [12.8, 0.345, 0.76], stairsClimb: [4.207, 2.4, 0.76], stairsDescend: [13.15, 0.16, 0.76],
  SA_then_WA: [5.11, 2.4, 0.95], WD_then_WA: [4.257, 2.4, 0.55], SD_SA_WD_then_WA: [4.257, 2.4, 0.55],
};
const placement = {
  fenceValid: 'Fence · Ready to place', fenceOnPlayer: 'Fence · Blocked by a farm object',
  fenceOnDeck: 'Fence · Blocked by a farm object', fenceOnWater: 'Fence · Blocked by a farm object',
  fenceOnCottage: 'Fence · Blocked by a farm object', plotValid: 'Plot · Ready to place',
  placed: ['placed-fence', 'placed-plot'], afterUndo: ['placed-fence'],
};
const state = (mode, rainAmount, cloudyAmount) => ({ weather: { mode, rainAmount, cloudyAmount }, pixel: true });
const states = {
  morning: state('clear', 0, 0), daytime: state('clear', 0, 0), sunset: state('clear', 0, 0),
  night: state('clear', 0, 0), 'night-rain': state('rain', 1, 0), cloudy: state('cloudy', 0, 1), rain: state('rain', 1, 0),
};

/** Compare stable QA positions/states, not the nondeterministic screenshot pixels or sampling cadence. */
export function compareQaSequences(baseline, candidate) {
  const checks = [];
  const failures = [];
  function check(name, actual, expected, tolerance = 0) {
    const ok = typeof expected === 'number'
      ? typeof actual === 'number' && Math.abs(actual - expected) <= tolerance + 1e-12
      : JSON.stringify(actual) === JSON.stringify(expected);
    const result = { name, expected, actual, tolerance, ok };
    checks.push(result);
    if (!ok) failures.push(result);
  }
  function position(name, actual, expected) {
    if (!Array.isArray(actual) || actual.length !== 3) {
      check(name, actual, expected);
      return;
    }
    for (let i = 0; i < 3; i++) check(`${name}.${'xyz'[i]}`, actual[i], expected[i]);
  }
  const reference = baseline.sequences.run1;
  for (const name of ['run1', 'run2']) {
    const run = baseline.sequences[name];
    position(`baseline.${name}.spawn`, run.spawn.pos, checkpoints.spawn);
    position(`baseline.${name}.walkD2s`, run.walkD2s.end, checkpoints.walkD2s);
    position(`baseline.${name}.walkSA`, run.walkSA.end, checkpoints.walkSA);
    position(`baseline.${name}.padArrival`, run.padArrival, checkpoints.padArrival);
    position(`baseline.${name}.stairsClimb`, run.stairsClimb.end, checkpoints.stairsClimb);
    position(`baseline.${name}.stairsDescend`, run.stairsDescend.end, checkpoints.stairsDescend);
    for (const route of ['SA_then_WA', 'WD_then_WA', 'SD_SA_WD_then_WA']) {
      position(`baseline.${name}.${route}`, run.padSide[route].end, checkpoints[route]);
    }
    check(`baseline.${name}.bridgePeak`, run.bridgeCrossing.yMax, 2.52);
    check(`baseline.${name}.placement`, run.placement, placement);
    check(`baseline.${name}.states`, run.states, states);
  }
  check('baseline.errors', baseline.errors, []);
  check('candidate.errors', candidate.errors, []);
  check('browser', candidate.browser, baseline.browser);
  for (const name of ['run1', 'run2']) {
    const run = candidate.sequences[name];
    position(`${name}.spawn`, run.spawn.pos, checkpoints.spawn);
    position(`${name}.walkD2s`, run.walkD2s.end, checkpoints.walkD2s);
    position(`${name}.walkSA`, run.walkSA.end, checkpoints.walkSA);
    check(`${name}.bridge.end.x`, run.bridgeCrossing.end[0], 7.6);
    check(`${name}.bridge.end.y`, run.bridgeCrossing.end[1], 2.4);
    const z = run.bridgeCrossing.end[2];
    const referenceZ = [baseline.sequences.run1.bridgeCrossing.end[2], baseline.sequences.run2.bridgeCrossing.end[2]]
      .reduce((best, value) => Math.abs(z - value) < Math.abs(z - best) ? value : best);
    check(`${name}.bridge.end.z`, z, referenceZ, 0.08);
    check(`${name}.bridge.yMin`, run.bridgeCrossing.yMin, 2.4);
    check(`${name}.bridge.yMax`, run.bridgeCrossing.yMax, 2.52);
    position(`${name}.padArrival`, run.padArrival, checkpoints.padArrival);
    position(`${name}.stairsClimb`, run.stairsClimb.end, checkpoints.stairsClimb);
    check(`${name}.stairsClimb.yMax`, run.stairsClimb.yMax, 2.4);
    position(`${name}.stairsDescend`, run.stairsDescend.end, checkpoints.stairsDescend);
    check(`${name}.stairsDescend.yMin`, run.stairsDescend.yMin, 0.16);
    for (const route of ['SA_then_WA', 'WD_then_WA', 'SD_SA_WD_then_WA']) {
      position(`${name}.${route}`, run.padSide[route].end, checkpoints[route]);
      check(`${name}.${route}.yMin`, run.padSide[route].yMin, 0.16);
      check(`${name}.${route}.yMax`, run.padSide[route].yMax, 2.4);
    }
    check(`${name}.placement`, run.placement, reference.placement);
    check(`${name}.states`, run.states, reference.states);
  }
  return { checks, failures, ignored: ['screenshot pixels', 'sample counts', 'per-sample maximum y step',
    'in-motion starting samples'], reason: 'QA records real-time samples; timing, waterfall and rain vary.' };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [baselinePath, candidatePath, outputPath] = process.argv.slice(2);
  assert.ok(baselinePath && candidatePath, 'Usage: node tools/compare-qa-sequences.mjs <baseline.json> <candidate.json> [report.json]');
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
  const report = compareQaSequences(baseline, candidate);
  if (outputPath) await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.checks.length - report.failures.length}/${report.checks.length} QA sequence checks pass`);
  if (report.failures.length) {
    console.error(JSON.stringify(report.failures, null, 2));
    process.exitCode = 1;
  }
}
