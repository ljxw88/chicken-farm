import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evidenceDirectory, runDirectory } from './config.mjs';

const assets = [];
for (const id of ['barrel', 'hay-bale', 'round-oak']) {
  const report = JSON.parse(await readFile(join(runDirectory, id, 'verify/report.json'), 'utf8'));
  const hard = report.hard, visual = report.visual;
  assets.push({ id, status: 'needs-human', specHash: report.specHash, bibleHash: report.bibleHash, recipeHash: report.recipeHash,
    hardFailures: hard.failures, checks: hard.metrics.checks, triangles: hard.metrics.triangles, triangleBudget: hard.metrics.triangleBudget,
    partCount: hard.metrics.partCount, colorCount: hard.metrics.colorCount, bounds: hard.metrics.bounds,
    visualFailures: visual.failures, minimumDayPixels: Math.min(...visual.metrics.samples.filter((sample) => sample.phase === 'daytime').map((sample) => sample.pixels)),
    identityPartBestPixels: Object.fromEntries(Object.entries(visual.metrics.identityPartVisibility).map(([name, part]) => [name, Math.max(...part.views.map((view) => view.pixels))])),
    keyLight: visual.metrics.keyLight, unmeasured: visual.metrics.unmeasured,
    frameCount: visual.metrics.frameIndex.length, browserLoadAttempts: visual.metrics.loadAttempts });
}
const result = { status: 'needs-human', noRuntimeAssetsRegistered: true, renderer: 'pre-EBR-80', assets };
await writeFile(join(evidenceDirectory, 'verification-summary.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
