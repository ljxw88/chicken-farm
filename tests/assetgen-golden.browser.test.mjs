import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { root } from '../tools/assetgen/config.mjs';

test('four signed goldens pass their real-game geometry and 24-yaw interior jitter audit', { timeout: 240000 }, () => {
  const output = execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'verify', '--signed', 'all'],
    { cwd: root, encoding: 'utf8', timeout: 210000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal((output.match(/"status": "PASS"/g) || []).length, 4, output);
  assert.equal((output.match(/"views": 24/g) || []).length, 4, output);
  assert.equal((output.match(/"flickerCandidates": 0/g) || []).length, 4, output);
  assert.equal((output.match(/"code": "SIGNED_S2_LEGACY"/g) || []).length, 1, output);
  assert.match(output, /Signed placement fence has a narrow end-on silhouette/);
});
