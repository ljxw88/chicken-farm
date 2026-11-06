import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'vite';

// Run the *current* detector against a pristine archived main without
// checking out, resetting, or modifying the user's worktree. The nonzero exit
// status is expected: it demonstrates that the baseline fails the detector.
const root = process.cwd();
const ref = process.env.LIGHTING_BASELINE_REF || 'a61bac91e950ed3b03b3a3a6d3e1b3a57afe2671';
const sha = execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
const evidence = resolve(process.env.LIGHTING_EVIDENCE_DIR || 'evidence/lighting');
await mkdir(evidence, { recursive: true });
let tempParent = '/tmp/opencode';
try { await access(tempParent, constants.W_OK); } catch { tempParent = tmpdir(); }
const temp = await mkdtemp(join(tempParent, 'chicken-lighting-main-'));
let server;
try {
  const archive = join(temp, 'baseline.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', archive, sha, '--', 'src', 'index.html', 'package.json'], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', temp]);
  await symlink(join(root, 'node_modules'), join(temp, 'node_modules'), 'dir');
  server = await createServer({
    root: temp, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [temp, root] } },
  });
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Baseline Vite server did not expose a port');
  const url = `http://127.0.0.1:${address.port}`;
  await writeFile(join(evidence, 'before-baseline.json'), `${JSON.stringify({ ref, sha, source: 'git archive', url }, null, 2)}\n`);
  console.log(`Testing pristine baseline ${sha} at ${url}; assertion failures are expected.`);
  const child = spawn(process.execPath, ['--test', 'tests/browser/lighting.browser.mjs'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, LIGHTING_URL: url,
      LIGHTING_EVIDENCE_DIR: evidence, LIGHTING_CAPTURE_LABEL: 'before' },
  });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => resolveExit(status ?? (signal ? 1 : 0)));
  });
  process.exitCode = code;
} finally {
  await server?.close();
  // This is only the unique directory created by mkdtemp above; the symlinked
  // node_modules is unlinked, never recursively removed from the worktree.
  await rm(temp, { recursive: true, force: true });
}
