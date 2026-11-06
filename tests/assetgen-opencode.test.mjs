import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runOpenCode } from '../tools/assetgen/opencode.mjs';

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
