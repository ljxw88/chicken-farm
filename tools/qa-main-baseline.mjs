import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

// Run the supplied Graphics Gate against a pristine archived main, without
// touching this branch or re-recording the signed EBR-73 parity baseline.
const ref = process.env.LIGHTING_BASELINE_REF || 'c59b0433e4bec1b7d7dce6e69833dab6d64bdbaa';
const gate = process.env.GRAPHICS_GATE_DIR || '/home/michael/OpenBot/Shared/qa-graphics-gate';
const output = resolve(process.env.GRAPHICS_MAIN_OUTPUT || 'evidence/lighting/qa-main-c59');
const root = process.cwd();
const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
let temp;
let server;
try {
  try { temp = await mkdtemp('/tmp/opencode/chicken-qa-main-'); }
  catch (error) {
    if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
    temp = await mkdtemp(join(tmpdir(), 'chicken-qa-main-'));
  }
  const archive = join(temp, 'main.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', archive, sha, '--', 'src', 'index.html', 'package.json']);
  execFileSync('tar', ['-xf', archive, '-C', temp]);
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  await mkdir(output, { recursive: true });
  server = await createServer({ root: temp, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [temp, root] } } });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Baseline server did not expose a port');
  console.log(`QA baseline ${sha}`);
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const review = process.argv.includes('--review');
  if (!review) await writeFile(join(output, 'source.json'), `${JSON.stringify({ ref, sha, source: 'git archive' }, null, 2)}\n`);
  const script = review ? resolve('tools/lighting-review.mjs') : join(gate, 'gfx-audit.mjs');
  const args = review ? [script] : [script, baseUrl, output, `${root}/`];
  const child = spawn(process.execPath, args, {
    cwd: root, stdio: 'inherit', env: { ...process.env, LIGHTING_URL: baseUrl, LIGHTING_REVIEW_LABEL: 'before' },
  });
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
} finally {
  await server?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
}
