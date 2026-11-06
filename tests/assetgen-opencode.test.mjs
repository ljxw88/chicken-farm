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

test('free-provider quota failure stops retries and writes a work order', { timeout: 90000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-quota-test-'));
  const binary = join(directory, 'fake-opencode');
  const specPath = join(directory, 'spec.json');
  const id = 'quota-test';
  const spec = { id, category: 'prop', brief: 'A chunky test object with clear identity features.', size: { width: 1, depth: 1, height: 1 },
    paletteHints: ['wood.mid'], referenceAssetIds: ['signed-fence'],
    identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'cap', description: 'A clear cap' }, { id: 'base', description: 'A grounded base' }] };
  await writeFile(binary, '#!/bin/sh\nprintf \'%s\\n\' \'{"type":"error","error":{"type":"provider.free-limit","message":"Free usage limit reached"}}\'\nexit 1\n');
  await chmod(binary, 0o755);
  await writeFile(specPath, JSON.stringify(spec));
  try {
    execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'new', specPath], { cwd: root, encoding: 'utf8', timeout: 70000,
      env: { ...process.env, OPENCODE_BIN: binary, ASSETGEN_RUN_DIR: join(directory, 'runs') } });
    assert.fail('Quota failure must exit nonzero');
  } catch (error) {
    assert.notEqual(error.status, 0);
  }
  const run = join(directory, 'runs', id);
  const final = JSON.parse(await readFile(join(run, 'final.json'), 'utf8'));
  assert.equal(final.status, 'needs-human');
  assert.equal(final.history.length, 1);
  assert.match(final.stopReason, /quota/i);
  assert.match(await readFile(join(run, 'work-order.md'), 'utf8'), /asset:verify/);
});

test('ASSETGEN_IMAGES=0 records visual critique not run and cannot promote a candidate', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-no-vision-test-'));
  const binary = join(directory, 'fake-opencode');
  const specPath = join(directory, 'spec.json'), recipeFile = join(directory, 'recipe.json');
  const id = 'no-vision-test';
  const spec = { id, category: 'prop', brief: 'A chunky test object with three visible features.', size: { width: 0.8, depth: 0.8, height: 0.96 },
    paletteHints: ['wood.mid'], referenceAssetIds: ['signed-fence'],
    identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'cap', description: 'A clear cap' }, { id: 'top', description: 'A raised top' }] };
  const recipe = { id, category: 'prop', footprint: { w: 0.8, d: 0.8 }, height: 0.96, origin: 'base-center', facing: '+Z',
    parts: [
      { name: 'body', prim: 'box', size: [0.8, 0.6, 0.8], at: [0, 0.3, 0], mat: 'wood.mid', feature: 'body' },
      { name: 'cap', prim: 'box', size: [0.7, 0.2, 0.7], at: [0, 0.68, 0], mat: 'timber', feature: 'cap' },
      { name: 'top', prim: 'box', size: [0.3, 0.2, 0.3], at: [0, 0.86, 0], mat: 'wood.light', feature: 'top' },
    ], anchors: {}, emissive: [], collision: { type: 'box', w: 0.8, d: 0.8, h: 0.96 }, slots: {}, tags: [] };
  await writeFile(specPath, JSON.stringify(spec)); await writeFile(recipeFile, JSON.stringify(recipe));
  await writeFile(binary, `#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a[0]==='api'){console.log(JSON.stringify(a.at(-1).endsWith('/message')?{data:[{type:'assistant',model:{providerID:'fixture',id:'fake'}}]}:{data:{tokens:{input:1,output:1},cost:0}}));}else{const f=String.fromCharCode(96).repeat(3);console.log(JSON.stringify({type:'step_start',sessionID:'ses_fixture'}));console.log(JSON.stringify({type:'text',sessionID:'ses_fixture',part:{text:f+'json\\n'+fs.readFileSync(process.env.FAKE_RECIPE,'utf8')+'\\n'+f}}));}\n`);
  await chmod(binary, 0o755);
  execFileSync(process.execPath, ['tools/assetgen/cli.mjs', 'new', specPath, '--loop-off'], { cwd: root, encoding: 'utf8', timeout: 100000,
    env: { ...process.env, OPENCODE_BIN: binary, FAKE_RECIPE: recipeFile, ASSETGEN_RUN_DIR: join(directory, 'runs'),
      ASSETGEN_EVIDENCE_DIR: join(directory, 'evidence'), ASSETGEN_IMAGES: '0' } });
  const final = JSON.parse(await readFile(join(directory, 'runs', id, 'final.json'), 'utf8'));
  assert.equal(final.status, 'needs-human');
  assert.equal(final.visualCritiqueStatus, 'visual critique not run');
  assert.deepEqual(final.criticModelIds, []);
});
