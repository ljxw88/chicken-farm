import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { evidenceDirectory, readBible, readSpec, recipePath, root, runDirectory } from './config.mjs';
import { isBetterCandidate } from './scoring.mjs';

const { spec } = await readSpec(process.argv[2] || '');
const { rules } = await readBible();
const run = join(runDirectory, spec.id);
let best = null;
const rounds = (await readdir(run)).filter((name) => /^round-\d+$/.test(name)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
for (const round of rounds) for (const stage of rules.loop.stages) {
  const dir = join(run, round, `stage-${stage}`);
  let report, recipe;
  try {
    report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
    recipe = JSON.parse(await readFile(join(dir, 'recipe.json'), 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const candidate = { score: report.score, recipe, stage, round: report.round, hardFailureCount: report.hard.failures.length,
    lowerTrust: !!report.hard.metrics.lowerTrust, blockers: report.blockers,
    report: relative(root, join(dir, 'report.json')),
    sheet: report.visual && !report.visual.failures.some((failure) => failure.code === 'BROWSER') ? relative(root, join(dir, 'render/sheet.png')) : null };
  if (isBetterCandidate(candidate, best, rules.loop.stages)) best = candidate;
}
if (!best) throw new Error('No recorded candidate to select');
const final = JSON.parse(await readFile(join(run, 'final.json'), 'utf8'));
const previousSelection = { round: final.best?.round, stage: final.best?.stage, score: final.best?.score };
final.best = best;
final.bestSelectionNote = `Tie-break correction: prefer a later equally scored, equally clean and equally trusted stage. Previous selection: ${JSON.stringify(previousSelection)}. Historical reports and critic sheets are unchanged.`;
await writeFile(join(run, 'best.json'), `${JSON.stringify({ status: 'needs-human', ...best }, null, 2)}\n`);
await writeFile(join(run, 'final.json'), `${JSON.stringify(final, null, 2)}\n`);
await writeFile(recipePath(spec), `${JSON.stringify(best.recipe, null, 2)}\n`);
if (best.sheet) await copyFile(join(root, best.sheet), join(evidenceDirectory, `${spec.id}-recipe-sheet.png`));
console.log(JSON.stringify({ id: spec.id, previousSelection, selected: { round: best.round, stage: best.stage, score: best.score } }, null, 2));
