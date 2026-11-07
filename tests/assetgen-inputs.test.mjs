import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { goldenDirectory, root } from '../tools/assetgen/config.mjs';
import { verifierSourceHash } from '../tools/assetgen/bundle.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputs = {
  barrel: { recipe: '3ba1fc03f195a3c878c86a232d08e220fa5b9d81225691f9490659bfa92b4ead', image: '1da816793fe65c53417b5781da8a39322de405d341f4dc78d69017b87e073c0c' },
  'hay-bale': { recipe: 'bfb1c68e4a56f2b01b471431a58086894bf7311b808ab7c52f649f9c6f8b563a', image: 'c1b154ee7c1242ac3d7c4b3c0ed6faef1957fb413e57deb1e0a601b89c15717c' },
  'round-oak': { recipe: 'cd68af668c5ae48057547eb995d34c28927e0c403758f29d8170d8b23a3a3c6d', image: 'ff4cc12781c982fdd7800627f81b100622b0382e5ce959e1593844e7e83dc498' },
};

test('historical recipe and img2threejs reference inputs retain their original hashes', async () => {
  for (const [id, expected] of Object.entries(inputs)) {
    const recipe = JSON.parse(await readFile(join(goldenDirectory, 'historical', `${id}.json`), 'utf8'));
    const image = await readFile(join(goldenDirectory, 'img2threejs', `${id}.png`));
    assert.equal(recipe.id, id);
    assert.equal(sha(JSON.stringify(recipe)), expected.recipe);
    assert.equal(sha(image), expected.image);
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  }
});

test('fresh image probes override the retained probe, and malformed probes fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-probe-input-'));
  const script = "import {readVisionProbe} from './tools/assetgen/config.mjs'; console.log(JSON.stringify(await readVisionProbe()));";
  const env = { ...process.env, ASSETGEN_EVIDENCE_DIR: directory };
  const read = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env, encoding: 'utf8' }));
  const historical = read();
  assert.equal(historical.imageReadingObserved, true);
  assert.equal(historical.trials.filter((trial) => trial.correct).length, 3);
  const target = join(directory, 'vision-probe-ebr83-85');
  await mkdir(target);
  await writeFile(join(target, 'result.json'), '{invalid');
  assert.equal(read(), null);
  await writeFile(join(target, 'result.json'), JSON.stringify({ imageReadingObserved: false, trials: [] }));
  assert.equal(read().imageReadingObserved, false);
});

test('default generated output paths stay outside the repository', () => {
  const env = { ...process.env };
  delete env.ASSETGEN_EVIDENCE_DIR; delete env.ASSETGEN_RUN_DIR;
  const script = "import {evidenceDirectory,runDirectory} from './tools/assetgen/config.mjs'; console.log(JSON.stringify({evidenceDirectory,runDirectory}));";
  const locations = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, env, encoding: 'utf8' }));
  for (const location of Object.values(locations)) assert.ok(relative(root, location).startsWith('..'), location);
});

test('retained vision probe bytes are part of the verifier source hash', async () => {
  const path = join(goldenDirectory, 'vision-probe.json');
  const old = await verifierSourceHash();
  const modified = await verifierSourceHash({ readSource: async (filename, encoding) => filename === path
    ? `${await readFile(filename, encoding)} ` : readFile(filename, encoding) });
  assert.notEqual(modified, old);
});
