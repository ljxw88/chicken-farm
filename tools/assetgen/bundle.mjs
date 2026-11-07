import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './config.mjs';
import { inspectRecipe } from './geometry.mjs';
import { fitGeneratedRecipe } from './fit-generated.mjs';

export const hashText = (text) => createHash('sha256').update(text).digest('hex');
export const hashRecipe = (recipe) => hashText(JSON.stringify(recipe));

function receipt(data, sessionId) {
  try {
    const events = data.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const sessions = new Set(events.map((event) => event.sessionID).filter(Boolean));
    const text = events.filter((event) => event.type === 'text').map((event) => event.part?.text || '').join('\n');
    const block = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i)?.[1] ?? text;
    const start = block.indexOf('{'), end = block.lastIndexOf('}');
    return { validSession: sessions.size === 1 && sessions.has(sessionId), value: JSON.parse(block.slice(start, end + 1)) };
  } catch { return { validSession: false, value: null }; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

// Builder, validator and browser harness are all part of the verification source.
export async function verifierSourceHash({ includeCalibration = true, readSource = readFile } = {}) {
  const paths = ['src/assets/buildRecipe.ts', 'src/assets/palette.ts', 'src/assets/types.ts', 'src/assets/index.ts', 'tsconfig.json',
    'tools/assetgen/schema.mjs', 'tools/assetgen/geometry.mjs', 'tools/assetgen/fit-generated.mjs', 'tools/assetgen/recipe-cheatsheet.md', 'tools/assetgen/render.js', 'tools/assetgen/color.js',
    'tools/assetgen/visual.mjs', 'tools/assetgen/bundle.mjs', 'tools/assetgen/config.mjs', 'tools/assetgen/cli.mjs',
    'tools/assetgen/fixtures.mjs', 'tools/assetgen/signed-fixtures.mjs', 'tools/assetgen/signed-baselines.json', 'tools/assetgen/a9-calibration.mjs',
    'tools/assetgen/golden/vision-probe.json',
    'tools/assetgen/generator.mjs', 'docs/asset-lookdev-brief.md', 'package-lock.json',
    'src/scene/createScene.ts', 'src/scene/createIsland.ts', 'src/scene/createFarmLayout.ts', 'src/scene/createIsometricCamera.ts',
    'src/scene/farmPalette.ts', 'src/scene/farmBuildingMaterials.ts', 'src/scene/farmBuildingSpecs.ts',
    'src/scene/createCottage.ts', 'src/scene/createRampCoop.ts', 'src/scene/createStoneStairs.ts',
    'src/placement/createPlacementVisual.ts', 'src/character/createCharacter.ts',
    'src/lighting/dayNightPhases.ts', 'src/lighting/createDayNightCycle.ts', 'src/lighting/createPracticalLights.ts',
    'src/postprocess/index.ts', 'src/postprocess/PixelPresentation.ts', 'src/postprocess/pixelViewport.ts',
    'src/weather/createWeatherSystem.ts', 'src/weather/createRainEffect.ts', 'src/weather/rainSettings.ts', 'package.json'];
  if (includeCalibration) paths.push('tools/assetgen/a9-calibration.json', 'tools/assetgen/a9-calibration.sha256');
  async function includeSource(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await includeSource(path);
      else if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) paths.push(path);
    }
  }
  for (const directory of ['src/scene', 'src/lighting', 'src/weather', 'src/postprocess', 'src/character', 'src/placement']) await includeSource(directory);
  const files = await Promise.all([...new Set(paths)].sort().map(async (path) => `${path}\0${await readSource(join(root, path), 'utf8')}`));
  return hashText(files.join('\0'));
}

/** Never trust a saved PASS: recompute geometry and visual checks on current input. */
export async function auditBundleEntry({ recipe, spec, recipeBytes, specBytes, reportBytes, bible, report, signoff, receipts, environment, sourceHash, render }) {
  const failures = [];
  const fail = (code, message) => failures.push({ code, message });
  const hashes = { recipeHash: hashText(recipeBytes ?? JSON.stringify(recipe)), specHash: hashText(specBytes ?? JSON.stringify(spec)),
    bibleHash: hashText(bible.text), verifierHash: sourceHash };
  if (report?.status !== 'PASSED' || !Number.isInteger(report?.roundsUsed) || report.roundsUsed >= bible.rules.loop.maxRounds) {
    fail('STATUS', 'Only PASSED candidates below the four-round cap may be bundled');
  }
  if (!Array.isArray(report?.completedStages) || bible.rules.loop.stages.some((stage, index) => report.completedStages[index] !== stage) ||
      report?.best?.stage !== 'optimise') fail('STAGES', 'Every stage, including optimisation of the selected candidate, must have passed');
  for (const [key, value] of Object.entries(hashes)) {
    if (report?.[key] !== value) fail('HASH_MISMATCH', `${key} differs from the current source/spec/bible/verifier`);
  }
  const reportHash = hashText(reportBytes ?? JSON.stringify(report));
  if (!signoff || signoff.reviewer !== 'look-dev' || signoff.reportHash !== reportHash ||
      Object.entries(hashes).some(([key, value]) => signoff[key] !== value)) {
    fail('SIGNOFF', 'A separate Look Dev signoff for these exact hashes is required');
  }
  if (!report?.criticModelId || !report?.criticSession || !report?.generatorSession || report.criticSession === report.generatorSession ||
      report?.critique?.imageReviewed !== true || !Array.isArray(report?.critique?.blockers) || report.critique.blockers.length ||
      !report?.critique?.scores || !['silhouette', 'palette', 'shapeLanguage', 'valueStructure', 'sceneFit', 'craft']
        .every((key) => Number.isInteger(report.critique.scores[key]) && report.critique.scores[key] >= 4 && report.critique.scores[key] <= 5) ||
      spec.identityFeatures.some((feature) => report?.critique?.features?.[feature.id] !== true)) {
    fail('CRITIC_EVIDENCE', 'Independent visual critic session, model, scores and every identity feature are required');
  }
  if (!receipts?.generator || !receipts?.critic || hashText(receipts.generator) !== report?.generatorReceiptHash ||
      hashText(receipts.critic) !== report?.criticReceiptHash) fail('RECEIPT', 'Separate generator and critic transcripts must match their recorded hashes');
  else {
    const generated = receipt(receipts.generator, report.generatorSession);
    const critiqued = receipt(receipts.critic, report.criticSession);
    const fitted = generated.validSession ? fitGeneratedRecipe(generated.value, spec, bible.rules, environment) : null;
    if (!generated.validSession || !critiqued.validSession || JSON.stringify(stable(fitted?.recipe)) !== JSON.stringify(stable(recipe)) ||
        JSON.stringify(stable(fitted?.normalization ?? null)) !== JSON.stringify(stable(report?.best?.normalization ?? null)) ||
        JSON.stringify(stable(critiqued.value)) !== JSON.stringify(stable(report.critique))) {
      fail('RECEIPT', 'Session transcripts do not substantiate the current recipe and critique');
    }
  }
  const hard = inspectRecipe(recipe, spec, bible.rules, environment);
  failures.push(...hard.failures);
  let visual = null;
  if (!hard.failures.length && !failures.length && render) {
    visual = await render(recipe, spec);
    failures.push(...visual.failures);
    if (visual.metrics?.unmeasured?.length) fail('VISUAL_UNMEASURED', `Required visual checks remain unmeasured: ${visual.metrics.unmeasured.join('; ')}`);
  } else if (!render) fail('VISUAL_UNMEASURED', 'Fresh offline browser verification is required');
  return { status: failures.length ? 'REJECTED' : 'PASSED', failures, hashes, hard: { failures: hard.failures, metrics: hard.metrics }, visual };
}
