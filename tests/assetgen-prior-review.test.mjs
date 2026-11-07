import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readBible } from '../tools/assetgen/config.mjs';
import { makePrompt } from '../tools/assetgen/generator.mjs';
import { loadPriorReview } from '../tools/assetgen/prior-review.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const receipt = (sessionID, value) => `${JSON.stringify({ type: 'text', sessionID, part: { text: JSON.stringify(value) } })}\n`;
const bible = await readBible();
const spec = { id: 'review-fixture', category: 'prop', brief: 'A chunky barrel with a visible body and hoops.', size: { width: 0.8, depth: 0.8, height: 1 },
  paletteHints: ['wood.mid'], referenceAssetIds: ['signed-fence'],
  identityFeatures: [{ id: 'body', description: 'A broad body' }, { id: 'hoops', description: 'Visible broad hoops' }, { id: 'lid', description: 'A broad top lid' }] };
const specBytes = `${JSON.stringify(spec, null, 2)}\n`;
const recipe = { id: spec.id, parts: [{ name: 'stave-body' }, { name: 'hoop-top' }] };
const critique = { imageReviewed: true, action: 'refine-spec', scores: { silhouette: 3 }, features: { body: false },
  blockers: ['stave-body is obscured by hoop-top'], fixes: ['Narrow hoop-top and expose the stave-body.'] };

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'assetgen-prior-review-'));
  const recipeBytes = `${JSON.stringify(recipe, null, 2)}\n`;
  const generator = receipt('ses-generator', recipe), critic = receipt('ses-critic', critique);
  const report = { id: spec.id, specHash: sha(specBytes), bibleHash: sha(bible.text), recipeHash: sha(recipeBytes),
    generatorSession: 'ses-generator', criticSession: 'ses-critic', criticModelId: 'opencode/vision-free',
    generatorReceiptHash: sha(generator), criticReceiptHash: sha(critic), critiqueStatus: 'independent visual critique recorded',
    critique, blockers: [{ code: 'CRITIQUE', message: 'stave-body is obscured by hoop-top' }] };
  await Promise.all([writeFile(join(dir, 'recipe.json'), recipeBytes), writeFile(join(dir, 'generator.jsonl'), generator),
    writeFile(join(dir, 'critic.jsonl'), critic), writeFile(join(dir, 'report.json'), JSON.stringify(report))]);
  return { dir, report };
}

test('an authenticated prior critique reaches a recipe-only revision without overriding the critic', async () => {
  const { dir } = await fixture();
  const prior = await loadPriorReview(join(dir, 'report.json'), spec, specBytes, bible.text);
  assert.equal(prior.provenance.priorCriticAction, 'refine-spec');
  assert.deepEqual(prior.feedback.critique, critique);
  const prompt = await makePrompt(spec, bible, 'blockout', prior.recipe, prior.feedback, null);
  assert.match(prompt, /CURRENT RECIPE/);
  assert.match(prompt, /Narrow hoop-top and expose the stave-body/);
  assert.match(prompt, /Do not change the spec or disregard the prior verdict/);
  assert.match(prompt, /fresh independent critic/);
});

test('prior feedback rejects changed receipts, changed specs and non-independent critiques', async () => {
  const first = await fixture();
  await writeFile(join(first.dir, 'critic.jsonl'), `${await readFile(join(first.dir, 'critic.jsonl'), 'utf8')} `);
  await assert.rejects(() => loadPriorReview(join(first.dir, 'report.json'), spec, specBytes, bible.text), /receipts do not match/);
  const second = await fixture();
  await assert.rejects(() => loadPriorReview(join(second.dir, 'report.json'), spec, `${specBytes} `, bible.text), /does not match/);
  second.report.criticSession = second.report.generatorSession;
  await writeFile(join(second.dir, 'report.json'), JSON.stringify(second.report));
  await assert.rejects(() => loadPriorReview(join(second.dir, 'report.json'), spec, specBytes, bible.text), /independent image critique/);
});
