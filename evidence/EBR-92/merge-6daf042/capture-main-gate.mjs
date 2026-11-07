// Capture the 6daf042 Gate G reference from a git archive, not a worktree.
// Run through farm-tools/heavy from the repository root.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { formatCapture } from '../format-capture.mjs';

const sha = '6daf042ad85882f020268baf53fc92fb09e921ad';
assert.equal(execFileSync('git', ['rev-parse', '--verify', '6daf042^{commit}'], { encoding: 'utf8' }).trim(), sha);
let temp;
try {
  temp = await mkdtemp('/tmp/opencode/ebr92-6daf-main-');
} catch (error) {
  if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
  temp = await mkdtemp(join(tmpdir(), 'ebr92-6daf-main-'));
}
const archive = join(temp, 'main.tar');
execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sha, 'index.html', 'package.json', 'src']);
execFileSync('tar', ['-xf', archive, '-C', temp]);
await symlink(resolve('node_modules'), join(temp, 'node_modules'), 'dir');
const server = await createServer({ root: temp, configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false } });
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Clean archive ${sha}: ${url}`);
  const child = spawn(process.execPath, ['evidence/EBR-92/capture.mjs', url, 'main-6daf042'], {
    stdio: 'inherit', env: { ...process.env, EBR92_ONLY_GATE: '1', EBR92_ONLY_DAY: '',
      EBR92_TEST_BASE_GAIN: '', EBR92_OUTPUT_ROOT: '' },
  });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (status) => resolveExit(status));
  });
  assert.equal(code, 0, 'Clean-main Gate G capture failed');
  const path = 'evidence/EBR-92/main-6daf042/capture.json';
  const report = JSON.parse(await readFile(path, 'utf8'));
  report.sourceSha = sha;
  await writeFile(path, formatCapture(report));
} finally {
  await server.close();
}
