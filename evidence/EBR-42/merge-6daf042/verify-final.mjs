import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Run after committing and rerunning the checks with EBR42_EVIDENCE_ROOT in an
// external scratch directory. This script writes only to that directory.
if (!process.argv[2]) throw new Error('Usage: node evidence/EBR-42/merge-6daf042/verify-final.mjs <scratch-directory>');
const scratch = resolve(process.argv[2]);
const recordedRoot = resolve('evidence/EBR-42');
const rerunRoot = join(scratch, 'evidence');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'Final worktree must be clean');
const [recordedCapture, rerunCapture, recordedPose, rerunPose, recordedLuma, rerunLuma, recordedQa, rerunQa] = await Promise.all([
  json(join(recordedRoot, 'comparison.json')), json(join(rerunRoot, 'comparison.json')),
  json(join(recordedRoot, 'merge-6daf042/same-pose.json')), json(join(rerunRoot, 'merge-6daf042/same-pose.json')),
  json(join(recordedRoot, 'smoke-retune/readability.json')), json(join(rerunRoot, 'smoke-retune/readability.json')),
  json(join(recordedRoot, 'merge-6daf042/qa-gate/parity.json')), json(join(rerunRoot, 'merge-6daf042/qa-gate/parity.json')),
]);
const expectedMain = '6daf042ad85882f020268baf53fc92fb09e921ad';
for (const report of [recordedCapture, rerunCapture, recordedQa, rerunQa]) assert.equal(report.main, expectedMain);
assert.equal(rerunCapture.candidateHead, head);
assert.equal(rerunPose.candidateHead, head);
assert.equal(rerunLuma.head, head);
assert.equal(rerunQa.sourceSnapshot.head, head);
for (const report of [recordedCapture, rerunCapture, recordedPose, rerunPose, recordedLuma, rerunLuma, recordedQa, rerunQa]) {
  assert.deepEqual(report.failures, []);
}
const paths = { srcTree: 'src', testsTree: 'tests', toolsTree: 'tools', indexHtml: 'index.html',
  packageJson: 'package.json', packageLock: 'package-lock.json' };
for (const [key, path] of Object.entries(paths)) {
  const actual = git('rev-parse', `${head}:${path}`);
  for (const report of [recordedCapture, rerunCapture, recordedPose, rerunPose, recordedLuma, rerunLuma, recordedQa, rerunQa]) {
    assert.equal(report.sourceSnapshot[key], actual, `${key} does not match the final commit`);
  }
}
assert.equal(rerunCapture.sourceStatus, '');
assert.equal(rerunLuma.sourceStatus, '');
assert.equal(rerunQa.sourceSnapshot.sourceStatus, '');
assert.equal(Object.keys(rerunPose.frames).length, 15);
for (const [name, frame] of Object.entries(rerunPose.frames)) {
  assert.equal(frame.changedPixels, 0, name);
  assert.equal(frame.fireflyMaskChanged, 0, name);
  assert.equal(frame.poseMatches, true, name);
  assert.equal(frame.effectStateMatches, true, name);
  assert.equal(recordedPose.frames[name].changedPixels, 0, name);
}
assert.equal(Object.keys(rerunQa.frames).length, 8);
const qaCounts = {};
for (const [name, frame] of Object.entries(rerunQa.frames)) {
  const before = recordedQa.frames[name];
  assert.ok(before, name);
  assert.equal(frame.outsideAllowed, 0, name);
  assert.equal(frame.hiddenChanged, 0, name);
  assert.deepEqual(frame.stateMismatches, [], name);
  for (const key of ['changedPixels', 'outsideAllowed', 'hiddenChanged', 'interactionPixels', 'smoke', 'fireflies']) {
    assert.deepEqual(frame[key], before[key], `${name}: ${key} differs from the committed evidence`);
  }
  qaCounts[name] = { changedPixels: frame.changedPixels, smoke: frame.smoke.changed,
    fireflies: frame.fireflies.changed, outsideAllowed: frame.outsideAllowed, hiddenChanged: frame.hiddenChanged };
}
for (const [name, current] of Object.entries(rerunCapture.cases)) {
  const before = recordedCapture.cases[name];
  assert.ok(before, name);
  for (const key of ['rawChanged', 'unmasked', 'hiddenChanged', 'smoke', 'fireflies']) {
    assert.deepEqual(current[key], before[key], `${name}: ${key} differs from the committed evidence`);
  }
}
for (const [name, current] of Object.entries(rerunLuma.cases)) {
  const before = recordedLuma.cases[name];
  assert.ok(before, name);
  assert.equal(current.samples.length, before.samples.length, name);
  for (let i = 0; i < current.samples.length; i++) {
    const a = current.samples[i]; const b = before.samples[i];
    for (const key of ['time', 'target', 'weather', 'nightAmount', 'screenMask', 'windows', 'puffs']) {
      assert.deepEqual(a[key], b[key], `${name} t=${a.time}: ${key} differs from the committed evidence`);
    }
  }
}
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
assert.deepEqual(unit, await tap(join(recordedRoot, 'merge-6daf042/unit.log')));
assert.deepEqual(browser, await tap(join(recordedRoot, 'merge-6daf042/browser.log')));
const handoff = await readFile('DELIVER-EBR-42.txt', 'utf8');
assert.doesNotMatch(handoff, /\b(?:pending|queued|running)\b/i, 'The handoff contains a pending result');
assert.ok(handoff.includes(`${unit.pass}/${unit.tests}`), 'The handoff omits the final unit count');
assert.ok(handoff.includes(`${browser.pass}/${browser.tests}`), 'The handoff omits the final browser count');
assert.ok(handoff.includes('/home/michael/OpenBot/Shared/qa-graphics-gate/gate-g-baseline-6daf042/'));
const qaSection = handoff.split('Canonical QA Gate G (6daf042)')[1]?.split('\n\n')[0];
assert.ok(qaSection, 'The handoff omits the canonical QA table');
for (const [name, counts] of Object.entries(qaCounts)) {
  const line = qaSection.split('\n').find((item) => item.trim().startsWith(`${name} `));
  assert.ok(line, `The handoff omits QA frame ${name}`);
  const columns = line.trim().split(/\s+/);
  assert.deepEqual(columns.slice(1, 6).map(Number),
    [counts.changedPixels, counts.smoke, counts.fireflies, counts.outsideAllowed, counts.hiddenChanged], name);
}
const maskSection = handoff.split('Intended pixel changes')[1]?.split('Visible-change ledger')[0];
assert.ok(maskSection, 'The handoff omits the 15-frame mask table');
for (const [name, frame] of Object.entries(rerunCapture.cases)) {
  const line = maskSection.split('\n').find((item) => item.trim().startsWith(`${name} `) && /^\s*\S+\s+\d/.test(item));
  assert.ok(line, `The handoff omits frame ${name}`);
  const columns = line.trim().split(/\s+/);
  assert.deepEqual(columns.slice(1, 4).map(Number), [frame.rawChanged, frame.retune.changedPixels, 0], name);
}
const lumaSection = handoff.split('Merged-source smoke measurements')[1]?.split('Spec tensions / omissions')[0];
assert.ok(lumaSection, 'The handoff omits the luma table');
for (const [name, scenario] of Object.entries(rerunLuma.cases)) {
  const line = lumaSection.split('\n').find((item) => item.trim().startsWith(`${name} `) && item.includes(' / '));
  assert.ok(line, `The handoff omits luma frame ${name}`);
  for (const sample of scenario.samples) assert.ok(line.includes(sample.screenMask.peakLuminance.toFixed(2)), name);
}
const build = await readFile(join(scratch, 'build.log'), 'utf8');
assert.match(build, /built in/);
assert.match(build, /^\[heavy\] released .*rc=0$/m);
for (const name of ['readability', 'capture', 'qa-gate', 'day-crops']) {
  const text = await readFile(join(scratch, `${name}.log`), 'utf8');
  assert.match(text, /^\[heavy\] released .*rc=0$/m, name);
}
const report = { head, main: expectedMain, unit, browser, qaCounts,
  samePoseFrames: Object.fromEntries(Object.entries(rerunPose.frames).map(([name, frame]) => [name, frame.changedPixels])),
  sourceTrees: Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, git('rev-parse', `${head}:${path}`)])) };
await writeFile(join(scratch, 'verified.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`FINAL ${head}: build, ${unit.pass} unit, ${browser.pass} browser, ${Object.keys(qaCounts).length} QA frames and ${Object.keys(report.samePoseFrames).length} same-pose frames verified`);
