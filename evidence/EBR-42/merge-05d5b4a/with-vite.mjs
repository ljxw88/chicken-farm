import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run inside the heavy wrapper from a clean checkout; stop only this server.
const [command, ...args] = process.argv.slice(2);
assert.ok(command, 'Usage: with-vite.mjs <command> [args...]');
const git = (...argv) => execFileSync('git', argv, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'The checkout must be clean');
if (process.env.EBR42_EXPECT_HEAD) assert.equal(head, process.env.EBR42_EXPECT_HEAD);
let temp;
try { temp = await mkdtemp('/tmp/opencode/ebr42-vite-'); }
catch (error) {
  if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
  temp = await mkdtemp(join(tmpdir(), 'ebr42-vite-'));
}
const config = join(temp, 'vite.config.mjs');
await writeFile(config, `export default { cacheDir: ${JSON.stringify(join(temp, 'cache'))} };\n`);
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5222',
  '--strictPort', '--config', config], { stdio: ['ignore', 'pipe', 'pipe'] });
let exited = false;
vite.on('exit', () => { exited = true; });
try {
  await new Promise((accept, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Vite did not start: ${output}`)), 30000);
    const consume = (data) => {
      output += data;
      if (output.includes('ready in')) { clearTimeout(timeout); accept(); }
    };
    vite.stdout.on('data', consume);
    vite.stderr.on('data', consume);
    vite.once('error', (error) => { clearTimeout(timeout); reject(error); });
    vite.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Vite exited ${code}: ${output}`)); });
  });
  const response = await fetch('http://127.0.0.1:5222/@vite/client');
  assert.equal(response.status, 200);
  console.log(`Clean checkout ${head} served on http://127.0.0.1:5222`);
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, EBR42_URL: 'http://127.0.0.1:5222' } });
  const code = await new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => accept(status ?? (signal ? 1 : 0)));
  });
  assert.equal(code, 0, `${command} failed`);
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '', 'The checkout became dirty');
} finally {
  if (!exited) {
    const stopped = new Promise((accept) => vite.once('exit', accept));
    vite.kill('SIGTERM');
    await stopped;
  }
  await rm(temp, { recursive: true, force: true });
}
