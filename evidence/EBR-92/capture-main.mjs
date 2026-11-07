// Recapture clean main without checking out or touching another worktree.
// Run through the heavy wrapper from the repo root.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'vite';
import { formatCapture } from './format-capture.mjs';

const expected = '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff';
const sha = execFileSync('git', ['rev-parse', '--verify', '5d9ba48^{commit}'], { encoding: 'utf8' }).trim();
assert.equal(sha, expected);
let temp;
try {
  temp = await mkdtemp('/tmp/opencode/ebr92-main-');
} catch (error) {
  if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
  temp = await mkdtemp(join(tmpdir(), 'ebr92-main-'));
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
  const child = spawn(process.execPath, ['evidence/EBR-92/capture.mjs', url, 'before'], { stdio: 'inherit' });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (status) => resolveExit(status));
  });
  assert.equal(code, 0, 'Clean-main capture failed');
  const path = 'evidence/EBR-92/before/capture.json';
  const report = JSON.parse(await readFile(path, 'utf8'));
  report.sourceSha = sha;
  await writeFile(path, formatCapture(report));
} finally {
  await server.close();
}
