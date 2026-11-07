import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';

// A cached archive is mutable, unlike a Git commit. Verify every tracked blob,
// including symlinks, and reject extra files before serving it as clean main.
export async function verifyBaselineArchive(root, sha, repo = process.cwd()) {
  const entries = execFileSync('git', ['ls-tree', '-r', '-z', '--full-tree', sha], { cwd: repo })
    .toString('utf8').split('\0').filter(Boolean);
  const expected = new Set();
  const algorithm = sha.length === 64 ? 'sha256' : 'sha1';
  for (const entry of entries) {
    const match = /^(100644|100755|120000) blob ([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
    assert.ok(match, `Unsupported baseline tree entry: ${entry}`);
    const [, mode, object, name] = match;
    expected.add(name);
    const path = join(root, name);
    const stat = await lstat(path);
    assert.equal(mode === '120000' ? stat.isSymbolicLink() : stat.isFile(), true,
      `Unexpected baseline file type: ${name}`);
    if (mode !== '120000') assert.equal(Boolean(stat.mode & 0o111), mode === '100755',
      `Cached baseline executable mode differs: ${name}`);
    const bytes = mode === '120000' ? Buffer.from(await readlink(path)) : await readFile(path);
    const hash = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(hash, object, `Cached baseline differs from ${sha}: ${name}`);
  }

  async function checkExtras(directory, prefix = '') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (!prefix && ['node_modules', '.pregate-deps', '.pregate-baseline.json'].includes(item.name)) continue;
      const name = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) await checkExtras(join(directory, item.name), name);
      else assert.ok(expected.has(name), `Unexpected file in cached baseline: ${name}`);
    }
  }
  await checkExtras(root);
  return expected.size;
}
