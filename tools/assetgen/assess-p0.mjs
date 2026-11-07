import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
import { verifierSourceHash } from './bundle.mjs';
import { readBible, readSpec, readVisionProbe, runDirectory, variantReferences } from './config.mjs';
import { assessReviewReadiness } from './review-readiness.mjs';

const id = process.argv[2];
if (!id) throw new Error('Usage: node tools/assetgen/assess-p0.mjs <id>');
const readText = async (path) => { try { return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const readJson = async (path) => { const text = await readText(path); return text === null ? null : JSON.parse(text); };
const { spec, path: specPath } = await readSpec(id);
const base = join(runDirectory, id);
const [specBytes, recipeBytes, final, verification, bible, sourceHash, probe] = await Promise.all([
  readFile(specPath, 'utf8'), readText(join(base, 'candidate.json')), readJson(join(base, 'final.json')),
  readJson(join(base, 'verify/report.json')), readBible(), verifierSourceHash(), readVisionProbe(),
]);
const selected = final?.best && Number.isInteger(final.best.round) && final.best.round >= 1 && final.best.round <= bible.rules.loop.maxRounds &&
  bible.rules.loop.stages.includes(final.best.stage) ? join(base, `round-${final.best.round}`, `stage-${final.best.stage}`) : null;
const stage = selected ? await readJson(join(selected, 'report.json')) : null;
const receipts = selected ? { generator: await readText(join(selected, 'generator.jsonl')), critic: await readText(join(selected, 'critic.jsonl')) } : null;
let server, environment = {};
try {
  if (stage?.normalization) {
    server = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
    const { buildRecipe } = await server.ssrLoadModule('/src/assets/buildRecipe.ts');
    const { ASSET_PALETTE, ACCENT_TOKENS } = await server.ssrLoadModule('/src/assets/palette.ts');
    const referenceRecipes = {};
    for (const reference of variantReferences(spec)) {
      const recipe = await readJson(join(runDirectory, reference, 'candidate.json'));
      if (recipe) referenceRecipes[reference] = recipe;
    }
    environment = { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS, referenceRecipes };
  }
  const assessment = assessReviewReadiness({ spec, specBytes, recipeBytes, bible, sourceHash, final, stage, verification, receipts, probe, environment });
  const output = { id, pipelineStatus: final?.status ?? 'not completed', roundsUsed: final?.roundsUsed ?? 0, ...assessment };
  await writeFile(join(base, 'review-readiness.json'), `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(output, null, 2));
} finally { await server?.close(); }
