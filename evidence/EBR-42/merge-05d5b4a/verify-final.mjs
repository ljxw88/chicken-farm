import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Validate the committed evidence against fresh, scratch-only runs at HEAD.
assert.ok(process.argv[2], 'Usage: verify-final.mjs <scratch-directory>');
const scratch = resolve(process.argv[2]);
const worktree = resolve('.');
assert.ok(scratch !== worktree && !scratch.startsWith(`${worktree}/`), 'Scratch must be outside the worktree');
const recorded = resolve('evidence/EBR-42/merge-05d5b4a');
const rerun = join(scratch, 'evidence/merge-05d5b4a');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
const main = '05d5b4aa566bf3d48cd2d1f5b94224224287c4c2';
const retune = '114e2afa2cedfabc82c9d438eb27a3dfb8825232';
assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'The final worktree must be clean');
execFileSync('git', ['merge-base', '--is-ancestor', main, head]);
execFileSync('git', ['merge-base', '--is-ancestor', retune, head]);
execFileSync('git', ['diff', '--quiet', retune, head, '--', 'src/effects']);
execFileSync('git', ['diff', '--quiet', main, head, '--', 'src/character/createCharacter.ts']);

const [recordedQa, rerunQa, recordedLuma, rerunLuma, pose] = await Promise.all([
  json(join(recorded, 'qa-gate/parity.json')), json(join(rerun, 'qa-gate/parity.json')),
  json(join(recorded, 'readability.json')), json(join(rerun, 'readability.json')),
  json('evidence/EBR-42/retune-468b4f3/merge-6daf042/same-pose.json'),
]);
for (const report of [recordedQa, rerunQa, recordedLuma, rerunLuma, pose]) assert.deepEqual(report.failures, []);
assert.equal(recordedQa.main, main);
assert.equal(rerunQa.main, main);
assert.equal(rerunQa.sourceSnapshot.head, head);
assert.equal(rerunLuma.head, head);
assert.equal(rerunQa.sourceSnapshot.sourceStatus, '');
assert.equal(rerunLuma.sourceStatus, '');
const paths = { srcTree: 'src', testsTree: 'tests', toolsTree: 'tools', indexHtml: 'index.html',
  packageJson: 'package.json', packageLock: 'package-lock.json' };
const sourceTrees = {};
for (const [key, path] of Object.entries(paths)) {
  sourceTrees[key] = git('rev-parse', `${head}:${path}`);
  for (const report of [recordedQa, rerunQa, recordedLuma, rerunLuma]) {
    assert.equal(report.sourceSnapshot[key], sourceTrees[key], `${key} differs from the final tip`);
  }
}
for (const [report, script] of [[recordedQa, 'evidence/EBR-42/merge-05d5b4a/qa-gate.mjs'],
  [recordedLuma, 'evidence/EBR-42/smoke-retune/measure.mjs']]) {
  execFileSync('git', ['diff', '--quiet', report.sourceSnapshot.head, head, '--', script]);
}

const qaCounts = {};
assert.equal(Object.keys(rerunQa.frames).length, 8);
for (const [name, frame] of Object.entries(rerunQa.frames)) {
  const before = recordedQa.frames[name];
  assert.ok(before, name);
  assert.equal(frame.outsideAllowed, 0, name);
  assert.equal(frame.hiddenChanged, 0, name);
  assert.deepEqual(frame.stateMismatches, [], name);
  assert.deepEqual(frame.errors, [], name);
  for (const key of ['changedPixels', 'outsideAllowed', 'hiddenChanged', 'interactionPixels', 'smoke', 'fireflies',
    'baselineSha256', 'candidateSha256']) assert.deepEqual(frame[key], before[key], `${name}: ${key}`);
  const baseline = await readFile(join(recorded, 'qa-gate/baseline', `${name}.png`));
  assert.equal(createHash('sha256').update(baseline).digest('hex'), frame.baselineSha256, name);
  qaCounts[name] = { changedPixels: frame.changedPixels, smoke: frame.smoke.changed, fireflies: frame.fireflies.changed,
    outsideAllowed: frame.outsideAllowed, hiddenChanged: frame.hiddenChanged };
}
const baselineMetadata = await json(join(recorded, 'qa-gate/baseline.json'));
assert.equal(baselineMetadata.sourceSha, main);
assert.deepEqual(baselineMetadata, await json(join(rerun, 'qa-gate/baseline.json')));

assert.equal(pose.candidateHead, retune);
assert.equal(pose.previousHead, '468b4f3b2bc415d69ec0e52575de127c2035e1a8');
assert.equal(Object.keys(pose.frames).length, 15);
for (const [name, frame] of Object.entries(pose.frames)) {
  assert.equal(frame.poseMatches, true, name);
  assert.equal(frame.fireflyStateMatches, true, name);
  assert.equal(frame.outsideSmoke, 0, name);
  assert.equal(frame.smokeHiddenChanged, 0, name);
  assert.equal(frame.fireflyMaskChanged, 0, name);
}

assert.equal(Object.keys(rerunLuma.cases).length, 9);
let samples = 0;
const peaks = { daytime: [], sunset: [], night: [], nightWindows: [] };
for (const [name, current] of Object.entries(rerunLuma.cases)) {
  const before = recordedLuma.cases[name];
  assert.ok(before, name);
  assert.equal(current.samples.length, 3, name);
  for (let i = 0; i < current.samples.length; i++) {
    const sample = current.samples[i];
    const prior = before.samples[i];
    for (const key of ['time', 'target', 'weather', 'nightAmount', 'screenMask', 'windows', 'puffs']) {
      assert.deepEqual(sample[key], prior[key], `${name} t=${sample.time}: ${key}`);
    }
    const phase = name.split('-')[0];
    assert.ok(sample.screenMask.pixels > 0 && sample.screenMask.peakLuminance >= (phase === 'night' ? 70 : 110), name);
    peaks[phase].push(sample.screenMask.peakLuminance);
    if (phase === 'night') {
      const windows = sample.windows.map((window) => window.luminance);
      assert.ok(sample.screenMask.peakLuminance < Math.min(...windows), name);
      peaks.nightWindows.push(...windows);
    }
    samples++;
  }
}
assert.equal(samples, 27);

async function tap(path) {
  const text = await readFile(path, 'utf8');
  const value = (name) => {
    const matches = [...text.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    assert.ok(matches.length, `${path}: missing ${name}`);
    return Number(matches.at(-1)[1]);
  };
  const result = { tests: value('tests'), pass: value('pass'), fail: value('fail') };
  assert.equal(result.fail, 0, path);
  assert.equal(result.tests, result.pass, path);
  assert.match(text, /^\[heavy\] released .*rc=0$/m, path);
  return result;
}
const unit = await tap(join(scratch, 'unit.log'));
const browser = await tap(join(scratch, 'browser.log'));
assert.deepEqual(unit, await tap(join(recorded, 'unit.log')));
assert.deepEqual(browser, await tap(join(recorded, 'browser.log')));
for (const dir of [recorded, scratch]) {
  const build = await readFile(join(dir, 'build.log'), 'utf8');
  assert.match(build, /tsc && vite build/);
  assert.match(build, /built in/);
  assert.match(build, /^\[heavy\] released .*rc=0$/m);
  for (const log of ['readability.log', 'qa-gate.log', 'masks.log']) {
    assert.match(await readFile(join(dir, log), 'utf8'), /^\[heavy\] released .*rc=0$/m, log);
  }
  assert.match(await readFile(join(dir, 'masks.log'), 'utf8'), /Independent mask verification PASS: 8\/8 frames/);
}

const handoff = await readFile('DELIVER-EBR-42.txt', 'utf8');
assert.doesNotMatch(handoff, /\b(?:pending|queued|running)\b/i);
assert.ok(handoff.includes(`${unit.pass}/${unit.tests}`));
assert.ok(handoff.includes(`${browser.pass}/${browser.tests}`));
assert.ok(handoff.includes('gate-g-baseline-05d5b4a/'));
assert.ok(handoff.includes('git rev-parse HEAD'));
const qaSection = handoff.split('Canonical QA Gate G (05d5b4a)')[1]?.split('\n\n')[0];
assert.ok(qaSection, 'Missing QA table');
for (const [name, counts] of Object.entries(qaCounts)) {
  const line = qaSection.split('\n').find((item) => item.trim().startsWith(`${name} `));
  assert.ok(line, `Missing ${name}`);
  assert.deepEqual(line.trim().split(/\s+/).slice(1, 6).map(Number),
    [counts.changedPixels, counts.smoke, counts.fireflies, counts.outsideAllowed, counts.hiddenChanged], name);
}
const lumaSection = handoff.split('Final-tip smoke-mask peaks')[1]?.split('\n\n')[0];
assert.ok(lumaSection, 'Missing smoke-mask peak table');
for (const [name, scenario] of Object.entries(rerunLuma.cases)) {
  const line = lumaSection.split('\n').find((item) => item.trim().startsWith(`${name} `));
  assert.ok(line, `Missing luma case ${name}`);
  for (const sample of scenario.samples) assert.ok(line.includes(sample.screenMask.peakLuminance.toFixed(2)), name);
}
const report = { head, main, unit, browser, qaCounts, samePoseFrames: Object.keys(pose.frames).length, lumaSamples: samples,
  lumaRange: Object.fromEntries(Object.entries(peaks).map(([key, values]) => [key, [Math.min(...values), Math.max(...values)]])), sourceTrees };
await writeFile(join(scratch, 'verified.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`FINAL ${head}: build, ${unit.pass} unit, ${browser.pass} browser, 8 QA frames and 27 luma samples verified`);
