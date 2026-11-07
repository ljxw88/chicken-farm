import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { comparePlacementEnvironmentReplay, replayComparisonTrace } from '../tools/placement-environment-replay.mjs';

async function temporary(prefix) {
  try { return await mkdtemp(`/tmp/opencode/${prefix}`); }
  catch (error) {
    if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
    return mkdtemp(join(tmpdir(), prefix));
  }
}

test('historical replay rejects a tampered archive before starting a browser', async (t) => {
  const archive = await temporary('ebr76-archive-integrity-');
  t.after(() => rm(archive, { recursive: true, force: true }));
  await writeFile(join(archive, 'index.html'), 'tampered');
  const baselineSha = '843c242da5f3bc0e4c2b12ef5484113165c914c7';
  await assert.rejects(comparePlacementEnvironmentReplay({ baselineRoot: archive, candidateRoot: process.cwd(),
    baselineSha, archivedBaselineSha: baselineSha }), /Archived baseline differs: index\.html/);
});

test('current-main replay compares plot parts and weather without historical exclusions', () => {
  const trace = [{ samples: [{ placement: { buttons: { plot: { pressed: 'true' } },
    ghost: { parts: [{ color: 0x5f4630 }] }, placed: [{ name: 'placed-plot', parts: [1, 2] }] },
  environment: { randomCalls: 7, rain: { visible: true, positions: [1, 2, 3] } } }] }];
  assert.deepEqual(replayComparisonTrace(trace, { historical: false, exactVisual: true }), trace);
  const old = replayComparisonTrace(trace, { historical: true, exactVisual: false })[0].samples[0];
  assert.equal('parts' in old.placement.ghost, false);
  assert.equal('parts' in old.placement.placed[0], false);
  assert.deepEqual(old.environment.rain, { visible: true });
  assert.equal('randomCalls' in old.environment, false);
});

test('garden-main replay rejects extra archive files before launching a browser', async (t) => {
  const directory = await temporary('ebr76-full-archive-');
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = process.cwd();
  const baselineSha = '8dd79b81bad7eec1d45a018715b357003f483f1c';
  const checkout = join(directory, 'checkout');
  const tar = join(directory, 'baseline.tar');
  await mkdir(checkout);
  execFileSync('git', ['archive', '--format=tar', `--output=${tar}`, baselineSha], { cwd: root });
  execFileSync('tar', ['-xf', tar, '-C', checkout]);
  await writeFile(join(checkout, 'unexpected-file'), 'not main');
  await assert.rejects(comparePlacementEnvironmentReplay({ baselineRoot: checkout, candidateRoot: root,
    baselineSha, archivedBaselineSha: baselineSha }), /Unexpected file in cached baseline: unexpected-file/);
});
