import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const harness = resolve('tools/selfplay/harness.mjs');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function temp(t) {
  let directory;
  try {
    directory = await mkdtemp('/tmp/opencode/ebr77-selfplay-test-');
  } catch (error) {
    if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
    directory = await mkdtemp(join(tmpdir(), 'ebr77-selfplay-test-'));
  }
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the self-play command completes its live stair-and-return route and writes verifiable artifacts',
  { timeout: 180000 }, async (t) => {
    const directory = await temp(t);
    const output = join(directory, 'run');
    const result = await exec(process.execPath, [harness, '--output', output, '--port', '0'], { timeout: 170000 });
    assert.match(result.stdout, /SELFPLAY PASS/);
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    assert.equal(report.ok, true);
    assert.equal(report.seed, 123);
    assert.deepEqual(report.viewport, { width: 1280, height: 720 });
    assert.match(report.rendering.renderer, /SwiftShader/i);
    assert.equal(report.rendering.pixel.enabled, true);
    assert.deepEqual(report.errors, { console: [], page: [], harness: [] });
    assert.ok(report.fps.frames > 0 && report.fps.elapsedSeconds > 0 && report.fps.value > 0);
    assert.equal(report.fps.value, report.fps.frames / report.fps.elapsedSeconds);
    assert.equal(report.trace.length, report.fps.frames);
    assert.ok(report.trace.every((sample) => sample.position.length === 3 && sample.position.every(Number.isFinite)));
    const steps = Object.fromEntries(report.steps.map((step) => [step.name, step]));
    assert.equal(steps['02-pad-click'].route.status, 'following');
    assert.equal(steps['06-return-click'].route.status, 'following');
    assert.ok(steps['03-outbound-bridge'].position[1] > 2.5);
    assert.ok(Math.abs(steps['04-stair-pad'].position[1] - 0.16) < 0.02);
    assert.ok(steps['05-climbed-stairs'].position[0] < 7.4);
    assert.ok(steps['07-return-bridge'].position[1] > 2.5);
    assert.ok(Math.hypot(steps['08-returned-to-spawn'].position[0], steps['08-returned-to-spawn'].position[2]) < 0.04);
    const images = report.steps.filter((step) => step.screenshot);
    assert.equal(images.length, 6);
    for (const step of images) {
      const image = await readFile(step.screenshot.path);
      assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1280, 720]);
      assert.equal(sha256(image), step.screenshot.sha256);
    }
  });

test('a port conflict fails the command and still writes a failure report', { timeout: 30000 }, async (t) => {
  const directory = await temp(t);
  const output = join(directory, 'blocked');
  const busy = createServer();
  await new Promise((done, fail) => { busy.once('error', fail); busy.listen(0, '127.0.0.1', done); });
  t.after(() => new Promise((done) => busy.close(done)));
  const port = busy.address().port;
  await assert.rejects(exec(process.execPath, [harness, '--output', output, '--port', String(port)]),
    (error) => error.code !== 0 && /SELFPLAY FAIL/.test(error.stdout));
  const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
  assert.equal(report.ok, false);
  assert.match(report.errors.harness.join('\n'), /already in use/i);
});

test('evidence paths cannot enter the worktree through a symlink or overwrite a report', { timeout: 30000 }, async (t) => {
  const directory = await temp(t);
  const link = join(directory, 'repo');
  await symlink(process.cwd(), link, 'dir');
  const target = `ebr77-selfplay-no-evidence-${process.pid}`;
  await assert.rejects(exec(process.execPath, [harness, '--output', join(link, target)]),
    (error) => /evidence must be outside the worktree/i.test(error.stderr));
  assert.equal(existsSync(join(process.cwd(), target)), false);
  const report = join(directory, 'report.json');
  await writeFile(report, 'keep');
  await assert.rejects(exec(process.execPath, [harness, '--output', directory]),
    (error) => /refusing to overwrite/i.test(error.stderr));
  assert.equal(await readFile(report, 'utf8'), 'keep');
});
