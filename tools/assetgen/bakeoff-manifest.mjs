import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, runDirectory } from './config.mjs';

const entries = [];
for (const id of ['barrel', 'hay-bale', 'round-oak']) {
  const directory = join(runDirectory, id);
  const final = JSON.parse(await readFile(join(directory, 'final.json'), 'utf8'));
  const verified = JSON.parse(await readFile(join(directory, 'verify/report.json'), 'utf8'));
  const recipe = final.best.recipe;
  entries.push({ id, category: final.category, status: 'needs-human', signedBy: null,
    recipe: `tools/assetgen/runs/${id}/best.json`, recipeSha256: createHash('sha256').update(JSON.stringify(recipe)).digest('hex'),
    specSha256: verified.specHash ?? null, bibleSha256: verified.bibleHash ?? null,
    score: final.best.score, rounds: final.roundsUsed, completedStages: final.completedStages,
    triangles: verified.hard.metrics.triangles, colors: verified.hard.metrics.colorCount,
    hardFailures: verified.hard.failures, visualFailures: verified.visual.failures,
    criticHistory: final.postVerificationCritiqueHistory?.map((item) => ({ sessionId: item.sessionId, action: item.review.action,
      features: item.review.features, sheetSha256: item.sheetSha256 ?? null })) ?? [],
    sheet: `evidence/assetgen/${id}-verified-sheet.png` });
}
await writeFile(join(root, 'tools/assetgen/bakeoff-manifest.json'), `${JSON.stringify({ version: 1, purpose: 'review only; not a runtime registry', assets: entries }, null, 2)}\n`);
console.log(`Recorded ${entries.length} needs-human bake-off candidates; none is signed or registered.`);
