import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readBible } from '../tools/assetgen/config.mjs';
import { critiqueRecipe, generatorAttachment } from '../tools/assetgen/generator.mjs';

test('a text-only generator can omit images without disabling the critic', () => {
  const old = process.env.ASSETGEN_GENERATOR_IMAGES;
  try {
    process.env.ASSETGEN_GENERATOR_IMAGES = '0';
    assert.equal(generatorAttachment({ imageReadingObserved: true }, '/sheet.png'), null);
    delete process.env.ASSETGEN_GENERATOR_IMAGES;
    assert.equal(generatorAttachment({ imageReadingObserved: true }, '/sheet.png'), '/sheet.png');
    assert.equal(generatorAttachment({ imageReadingObserved: false }, '/sheet.png'), null);
  } finally {
    if (old === undefined) delete process.env.ASSETGEN_GENERATOR_IMAGES; else process.env.ASSETGEN_GENERATOR_IMAGES = old;
  }
});

test('the independent critic uses the explicitly selected model and image', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'assetgen-critic-model-'));
  const binary = join(directory, 'opencode'), argsFile = join(directory, 'args.json');
  const fake = `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2);
if(args[0]==='api') console.log(JSON.stringify(args.at(-1).endsWith('/message') ? {data:[{type:'assistant',model:{providerID:'opencode',id:'test-vision-free'}}]} : {data:{tokens:{input:1,output:1},cost:0}}));
else { fs.writeFileSync(process.env.ARG_LOG,JSON.stringify(args)); const review={imageReviewed:true,scores:{silhouette:4,palette:4,shapeLanguage:4,valueStructure:4,sceneFit:4,craft:4},features:{body:true,cap:true,top:true},blockers:[],fixes:[],action:'continue'}; console.log(JSON.stringify({type:'text',sessionID:'ses_test',part:{text:JSON.stringify(review)}})); }
`;
  await writeFile(binary, fake); await chmod(binary, 0o755);
  const old = Object.fromEntries(['OPENCODE_BIN', 'ARG_LOG', 'ASSETGEN_CRITIC_MODEL', 'ASSETGEN_IMAGES'].map((key) => [key, process.env[key]]));
  try {
    process.env.OPENCODE_BIN = binary; process.env.ARG_LOG = argsFile;
    process.env.ASSETGEN_CRITIC_MODEL = 'opencode/test-vision-free'; delete process.env.ASSETGEN_IMAGES;
    const spec = { id: 'fixture', identityFeatures: [{ id: 'body' }, { id: 'cap' }, { id: 'top' }] };
    const result = await critiqueRecipe(spec, await readBible(), 'blockout', { hard: { failures: [] }, visual: null }, '/sheet.png', directory);
    const args = JSON.parse(await readFile(argsFile, 'utf8'));
    assert.equal(args[args.indexOf('--model') + 1], 'opencode/test-vision-free');
    assert.equal(args[args.indexOf('--file') + 1], '/sheet.png');
    assert.equal(result.modelId, 'opencode/test-vision-free');
    assert.equal(result.review.imageReviewed, true);
  } finally {
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
