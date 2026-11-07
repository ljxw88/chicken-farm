import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { root } from '../tools/assetgen/config.mjs';

test('external showcase builds real diagnostic packs without claiming a pass or overwriting them', { timeout: 180000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-showcase-e2e-'));
  const evidence = join(directory, 'evidence'), run = join(evidence, 'runs/barrel'), output = join(directory, 'showcase');
  await mkdir(run, { recursive: true });
  const recipe = { id: 'barrel', category: 'prop', footprint: { w: 0.8, d: 0.8 }, height: 1, origin: 'base-center', facing: '+Z',
    parts: [
      { name: 'body', prim: 'box', size: [0.8, 0.65, 0.8], at: [0, 0.325, 0], mat: 'wood.mid', feature: 'body' },
      { name: 'hoops', prim: 'box', size: [0.7, 0.2, 0.7], at: [0, 0.73, 0], mat: 'timber', feature: 'hoops' },
      { name: 'lid', prim: 'box', size: [0.5, 0.2, 0.5], at: [0, 0.9, 0], mat: 'wood.light', feature: 'lid' },
    ], anchors: {}, emissive: [], collision: { type: 'box', w: 0.8, d: 0.8, h: 1 }, slots: {}, tags: [] };
  await writeFile(join(run, 'candidate.json'), JSON.stringify(recipe));
  const env = { ...process.env, ASSETGEN_EVIDENCE_DIR: evidence, ASSETGEN_SHOWCASE_DIR: output, ASSETGEN_RUN_DIR: join(evidence, 'runs') };
  execFileSync(process.execPath, ['tools/assetgen/create-showcase.mjs'], { cwd: root, env, timeout: 165000, encoding: 'utf8' });
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  const barrel = manifest.assets.find((asset) => asset.id === 'barrel');
  assert.equal(manifest.assets.length, 9);
  assert.equal(barrel.status, 'incomplete run');
  assert.equal(barrel.pack.kind, 'diagnostic');
  assert.ok(barrel.failures.some((failure) => failure.code === 'NO_FINAL'));
  assert.equal(manifest.overview.available, true);
  assert.deepEqual(manifest.overview.included, ['barrel']);
  await access(join(output, 'images/barrel/sheet.png'));
  await access(join(output, 'images/island/night-315.png'));
  assert.match(await readFile(join(output, 'assets.html'), 'utf8'), /diagnostic only, not a verification pass/);
  assert.throws(() => execFileSync(process.execPath, ['tools/assetgen/create-showcase.mjs'], { cwd: root, env, timeout: 10000, stdio: 'pipe' }), /Refusing to overwrite/);
});
