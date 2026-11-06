import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runOpenCode } from '../tools/assetgen/opencode.mjs';
import { root, runDirectory } from '../tools/assetgen/config.mjs';

test('non-interactive generator closes stdin and sets PWD to the scratch location', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-cli-test-'));
  const binary = join(directory, 'fake-opencode');
  await writeFile(binary, `#!/bin/sh\nnode -e 'process.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({cwd:process.cwd(),pwd:process.env.PWD})))'\n`);
  await chmod(binary, 0o755);
  const previous = process.env.OPENCODE_BIN;
  process.env.OPENCODE_BIN = binary;
  try {
    const result = await runOpenCode([], { cwd: directory, timeout: 5000 });
    assert.deepEqual(JSON.parse(result.stdout), { cwd: directory, pwd: directory });
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = previous;
  }
});

test('work-order fallback does not require a browser or model', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-work-order-test-'));
  const id = `work-order-${randomBytes(6).toString('hex')}`;
  const run = join(runDirectory, id);
  await mkdir(runDirectory, { recursive: true });
  await mkdir(run); // Ensure the test owns the exact directory it cleans up.
  const spec = { id, category: 'prop', brief: 'A chunky test object with clear identity features.', size: { width: 1, depth: 1, height: 1 },
    paletteHints: ['wood.mid'], referenceAssetIds: ['signed-fence', 'signed-coop'],
    identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'cap', description: 'A clear cap' }, { id: 'base', description: 'A grounded base' }] };
  const path = join(directory, 'spec.json');
  await writeFile(path, JSON.stringify(spec));
  try {
    execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'new', path, '--work-order'], {
      cwd: root, timeout: 15000, env: { ...process.env, OPENCODE_BIN: '/nonexistent/opencode', PLAYWRIGHT_BROWSERS_PATH: '/nonexistent/chromium' },
    });
    const order = await readFile(join(run, 'work-order.md'), 'utf8');
    assert.match(order, /asset:verify/);
    assert.match(order, new RegExp(id));
  } finally {
    await unlink(join(run, 'work-order.md'));
    await rmdir(run);
    await unlink(path);
    await rmdir(directory);
  }
});
