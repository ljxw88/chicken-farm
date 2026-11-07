import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { root } from '../tools/assetgen/config.mjs';

test('verifier remeasures a changed signed fence and refuses edited calibration bytes', { timeout: 240000 }, async () => {
  const copy = await mkdtemp(join(tmpdir(), 'assetgen-recalibration-test-'));
  await cp(join(root, 'src'), join(copy, 'src'), { recursive: true });
  await mkdir(join(copy, 'tools/assetgen'), { recursive: true });
  await mkdir(join(copy, 'docs'));
  for (const entry of await readdir(join(root, 'tools/assetgen'), { withFileTypes: true })) {
    if (entry.isFile()) await cp(join(root, 'tools/assetgen', entry.name), join(copy, 'tools/assetgen', entry.name));
  }
  await cp(join(root, 'tools/assetgen/golden'), join(copy, 'tools/assetgen/golden'), { recursive: true });
  for (const name of ['asset-style-bible.md', 'asset-lookdev-brief.md']) await cp(join(root, 'docs', name), join(copy, 'docs', name));
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json']) await cp(join(root, name), join(copy, name));
  await symlink(join(root, 'node_modules'), join(copy, 'node_modules'));
  const source = join(copy, 'src/content/placementGeometry.ts');
  const before = await readFile(source, 'utf8');
  const changed = before.replace('post: [0.17, 0.95, 0.17]', 'post: [0.19, 0.95, 0.17]');
  assert.notEqual(changed, before);
  await writeFile(source, changed);
  const fixtureDir = join(copy, 'fixture');
  await mkdir(fixtureDir);
  const { spec, recipe } = JSON.parse(await readFile(join(root, 'tests/fixtures/assetgen/g3-hay-bale.fixture.json'), 'utf8'));
  recipe.parts[0].mat = '#ff00ff';
  await writeFile(join(fixtureDir, 'bad.fixture.json'), JSON.stringify({ spec, recipe }));
  let output;
  try {
    execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'verify', '--dir', fixtureDir, '--id', 'g3-hay-bale'],
      { cwd: copy, encoding: 'utf8', timeout: 210000, maxBuffer: 16 * 1024 * 1024 });
    assert.fail('the off-palette fixture must fail');
  } catch (error) {
    assert.equal(error.status, 1);
    output = error.stdout;
  }
  const result = JSON.parse(output);
  const original = JSON.parse(await readFile(join(root, 'tools/assetgen/a9-calibration.json'), 'utf8'));
  assert.ok(result.failures.some((failure) => failure.code === 'H1'));
  assert.equal(result.a9Calibration.source, 'recomputed');
  assert.notEqual(result.a9Calibration.signedHashes.fence, original.signedHashes.fence);
  for (const phase of ['daytime', 'morning', 'sunset']) {
    assert.equal(result.a9Calibration.floors[phase], Math.min(...['coop', 'fence', 'tread'].map((name) => result.a9Calibration.measurements[name][phase])));
  }
  await appendFile(join(copy, 'tools/assetgen/a9-calibration.json'), ' ');
  try {
    execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'verify', '--dir', fixtureDir, '--id', 'g3-hay-bale'],
      { cwd: copy, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.fail('edited calibration must not be accepted');
  } catch (error) {
    assert.equal(error.status, 1);
    assert.match(error.stderr, /A9_CALIBRATION_TAMPERED/);
  }
});
