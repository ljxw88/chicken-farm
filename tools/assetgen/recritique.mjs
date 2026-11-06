import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readBible, readSpec, runDirectory } from './config.mjs';
import { critiqueRecipe } from './generator.mjs';
import { isolatedSessionDirectory } from './opencode.mjs';

const { spec } = await readSpec(process.argv[2] || '');
const bible = await readBible();
const run = join(runDirectory, spec.id);
const final = JSON.parse(await readFile(join(run, 'final.json'), 'utf8'));
const verified = JSON.parse(await readFile(join(run, 'verify/report.json'), 'utf8'));
const historical = JSON.parse(await readFile(join(run, `round-${final.best.round}`, `stage-${final.best.stage}`, 'report.json'), 'utf8'));
const sheet = await readFile(join(run, 'verify/sheet.png'));
const sheetHash = createHash('sha256').update(sheet).digest('hex');
const snapshot = join(run, 'verify', `critic-sheet-${sheetHash.slice(0, 16)}.png`);
await writeFile(snapshot, sheet);
const cwd = await isolatedSessionDirectory();
const result = await critiqueRecipe(spec, bible, final.best.stage, { hard: verified.hard, visual: verified.visual }, snapshot, cwd);
if (!result.sessionId || result.sessionId === historical.generatorSession) throw new Error('Critic must use a separate OpenCode session');
const record = { sessionId: result.sessionId, durationMs: result.durationMs, usage: result.usage, review: result.review,
  sheetSha256: sheetHash, sheet: `verify/critic-sheet-${sheetHash.slice(0, 16)}.png`,
  status: result.review.imageReviewed ? 'visual critique recorded; human review required' : 'visual critique not run',
  purpose: 'Re-critique fixed-framing verification sheet; no new generation or correction round.' };
await writeFile(join(run, `verify/critic-${result.sessionId}.jsonl`), result.transcript);
await writeFile(join(run, `verify/critic-${result.sessionId}-prompt.txt`), result.prompt);
await writeFile(join(run, `verify/critic-${result.sessionId}.json`), `${JSON.stringify(record, null, 2)}\n`);
final.postVerificationCritiqueHistory = [...(final.postVerificationCritiqueHistory || (final.postVerificationCritique ? [final.postVerificationCritique] : [])), record];
final.postVerificationCritique = record;
await writeFile(join(run, 'final.json'), `${JSON.stringify(final, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
