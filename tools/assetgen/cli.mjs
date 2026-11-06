import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { evidenceDirectory, listSpecs, readBible, readSpec, recipePath, root, runDirectory } from './config.mjs';
import { inspectRecipe } from './geometry.mjs';
import { critiqueRecipe, generateRecipe, makePrompt } from './generator.mjs';
import { createVisualRunner } from './visual.mjs';
import { isBetterCandidate } from './scoring.mjs';
import { isolatedSessionDirectory } from './opencode.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const digestParts = (before, after) => {
  const old = new Map((before?.parts || []).map((part) => [part.name, JSON.stringify(part)]));
  const next = new Map((after?.parts || []).map((part) => [part.name, JSON.stringify(part)]));
  return { added: [...next.keys()].filter((key) => !old.has(key)), removed: [...old.keys()].filter((key) => !next.has(key)),
    changed: [...next.keys()].filter((key) => old.has(key) && old.get(key) !== next.get(key)) };
};

async function setup() {
  const bible = await readBible();
  const runner = await createVisualRunner();
  const { buildRecipe } = await runner.server.ssrLoadModule('/src/assets/buildRecipe.ts');
  const { ASSET_PALETTE, ACCENT_TOKENS } = await runner.server.ssrLoadModule('/src/assets/palette.ts');
  let probe = null;
  try { probe = JSON.parse(await readFile(join(evidenceDirectory, 'vision-probe-ebr83-85/result.json'), 'utf8')); } catch { /* no probe */ }
  return { bible, runner, environment: { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS }, probe };
}

function score(hard, visual, critic) {
  const hardCodes = new Set(hard.failures.map((failure) => failure.code));
  if (hardCodes.size) return Math.max(0, 35 - hardCodes.size * 7);
  const visualCodes = new Set((visual?.failures || []).map((failure) => failure.code));
  const criticMean = critic?.scores ? Object.values(critic.scores).reduce((sum, value) => sum + value, 0) / 30 * 100 : 0;
  return Math.max(0, Math.round((criticMean || 50) * 0.6 + 40 - visualCodes.size * 8));
}

async function newAsset(input, args) {
  if (!input) throw new Error('Usage: npm run asset:new -- <spec.json|id> [--work-order|--loop-off]');
  const { spec } = await readSpec(input);
  if (spec.category === 'building') throw new Error('New buildings are out of scope; signed building fixtures remain auditable.');
  const run = join(runDirectory, spec.id);
  await mkdir(run, { recursive: true });
  if (!args.includes('--work-order')) {
    try {
      await readFile(join(run, 'final.json'));
      throw new Error(`${spec.id} already has a completed bounded run; existing evidence will not be overwritten`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (args.includes('--work-order')) {
    const bible = await readBible();
    const prompt = await makePrompt(spec, bible, 'blockout', null, null, null);
    const path = join(run, 'work-order.md');
    await writeFile(path, `${prompt}\n\nSave JSON to ${relative(root, recipePath(spec))}, then run npm run asset:verify -- ${spec.id}.\n`);
    console.log(`Work order: ${relative(root, path)}`);
    return;
  }
  const context = await setup();
  const { bible, runner, environment, probe } = context;
  const sessionDir = await isolatedSessionDirectory();
  try {
    const first = Date.now();
    let round = 1, corrections = 0, stageIndex = 0;
    let current = null, previous = null, best = null, stopReason = null;
    let previousSheet = null;
    const stageCorrections = {};
    const history = [];
    const loopOff = args.includes('--loop-off');
    const stages = loopOff ? ['blockout'] : bible.rules.loop.stages;
    const roundLimit = loopOff ? 1 : bible.rules.loop.maxRounds;
    while (round <= roundLimit && stageIndex < stages.length) {
      const stage = stages[stageIndex];
      const stageDir = join(run, `round-${round}`, `stage-${stage}`);
      await mkdir(stageDir, { recursive: true });
      const prompt = await makePrompt(spec, bible, stage, current, previous, best?.recipe);
      await writeFile(join(stageDir, 'prompt.txt'), prompt);
      let generated;
      try {
        generated = await generateRecipe(prompt, sessionDir, probe?.imageReadingObserved ? previousSheet : null);
        await writeFile(join(stageDir, 'generator.jsonl'), generated.transcript);
      } catch (error) {
        const message = String(error);
        await writeFile(join(stageDir, 'generation-error.txt'), `${message}\n`);
        previous = { failures: [{ code: 'GENERATOR', message }], instruction: 'Retry the JSON generation/build with the exact error.' };
        history.push({ round, stage, action: 'refine-code', failure: message });
        if ((stageCorrections[stage] || 0) >= bible.rules.loop.maxCorrectionsPerStage || corrections >= bible.rules.loop.maxCorrectionsGlobal || round >= roundLimit) {
          stopReason = 'Generation retries exhausted';
          await writeFile(join(run, 'work-order.md'), `${prompt}\n\nSave JSON to ${relative(root, recipePath(spec))}, then run npm run asset:verify -- ${spec.id}.\n`);
          break;
        }
        corrections++; stageCorrections[stage] = (stageCorrections[stage] || 0) + 1;
        round++; continue;
      }
      const old = current;
      current = generated.recipe;
      await writeFile(recipePath(spec), json(current));
      await writeFile(join(stageDir, 'recipe.json'), json(current));
      const inspected = inspectRecipe(current, spec, bible.rules, environment);
      const hard = { failures: inspected.failures, metrics: inspected.metrics };
      let visual = null, review = null, criticSession = null, criticModelId = null, criticDurationMs = null, criticUsage = null, criticError = null;
      if (!hard.failures.length) {
        visual = await runner.capture(spec, bible.rules, join(stageDir, 'render'), current); // Only after the hard gate.
        const sheet = join(stageDir, 'render/sheet.png');
        if (process.env.ASSETGEN_IMAGES !== '0' && probe?.imageReadingObserved && !visual.failures.some((failure) => failure.code === 'BROWSER')) {
          try {
            const result = await critiqueRecipe(spec, bible, stage, { hard, visual }, sheet, sessionDir);
            criticSession = result.sessionId;
            criticModelId = result.modelId;
            criticDurationMs = result.durationMs;
            criticUsage = result.usage;
            await writeFile(join(stageDir, 'critic.jsonl'), result.transcript);
            await writeFile(join(stageDir, 'critic-prompt.txt'), result.prompt);
            review = result.review;
            if (!criticSession || criticSession === generated.sessionId || !criticModelId) throw new Error('Critic needs a distinct session and recorded model id');
            if (!review.imageReviewed) criticError = 'visual critique not run: critic reported that the image was unavailable';
          } catch (error) { criticError = `visual critique not run: ${String(error)}`; review = null; }
        } else criticError = 'visual critique not run: disabled, image capability not demonstrated, or render unavailable';
        previousSheet = visual.failures.some((failure) => failure.code === 'BROWSER') ? null : sheet;
      }
      const identityMissing = review ? spec.identityFeatures.filter((feature) => !review.features[feature.id]).map((feature) => feature.id) : [];
      const weakScores = review ? Object.entries(review.scores).filter(([, value]) => value < 4).map(([key, value]) => `${key}=${value}`) : [];
      const blockers = [...hard.failures, ...(visual?.failures || [])];
      if (criticError) blockers.push({ code: 'CRITIQUE_UNAVAILABLE', message: criticError });
      if (stage === 'lighting' && visual?.metrics?.unmeasured?.some((item) => item.startsWith('S3 ') || item.startsWith('S5 '))) {
        blockers.push({ code: 'LIGHTING_UNMEASURED', message: 'Three-step value and night-glow checks are not implemented under the merged EBR-80 lighting.' });
      }
      if (review && (weakScores.length || review.blockers.length || identityMissing.length)) {
        blockers.push({ code: 'CRITIQUE', message: [...weakScores, ...review.blockers, ...identityMissing.map((id) => `identity not seen: ${id}`)].join('; ') });
      }
      let stageScore = score(hard, visual, review);
      if (identityMissing.length || weakScores.length || review?.blockers.length) stageScore = Math.min(stageScore, 49);
      let action = blockers.length ? 'refine-code' : 'continue';
      if (review && ['request-input', 'stop', 'refine-spec', 'refine-code'].includes(review.action)) action = review.action;
      if (blockers.some((blocker) => blocker.code === 'LIGHTING_UNMEASURED')) action = 'request-input';
      const result = { id: spec.id, round, stage, action, score: stageScore,
        specHash: hash(JSON.stringify(spec)), bibleHash: hash(bible.text), recipeHash: hash(JSON.stringify(current)), hard, visual, critique: review,
        critiqueStatus: criticError || (review?.imageReviewed ? 'independent visual critique recorded' : 'visual critique not run'),
        generatorSession: generated.sessionId, generatorModelId: generated.modelId, criticSession, criticModelId, generatorDurationMs: generated.durationMs, criticDurationMs,
        generatorUsage: generated.usage, criticUsage, diff: digestParts(old, current), blockers };
      await writeFile(join(stageDir, 'report.json'), json(result));
      history.push({ round, stage, action, score: stageScore, blockers: blockers.map((item) => item.code),
        generatorSession: generated.sessionId, generatorModelId: generated.modelId, criticSession, criticModelId, generatorUsage: generated.usage, criticUsage });
      const candidate = { score: stageScore, recipe: current, stage, round, hardFailureCount: hard.failures.length,
        lowerTrust: !!hard.metrics.lowerTrust, blockers, report: relative(root, join(stageDir, 'report.json')),
        sheet: visual && !visual.failures.some((failure) => failure.code === 'BROWSER') ? relative(root, join(stageDir, 'render/sheet.png')) : null };
      if (isBetterCandidate(candidate, best, stages)) {
        best = candidate;
        await writeFile(join(run, 'best.json'), json({ status: 'needs-human', ...best }));
      }
      console.log(`${spec.id} round ${round} ${stage}: ${action}; score ${stageScore}; ${blockers.map((item) => item.code).join(', ') || 'stage checks clear'}; ${result.critiqueStatus}`);
      const visualSummary = Array.isArray(visual?.metrics?.samples) ? { identityVisibility: visual.metrics.identityVisibility, keyLight: visual.metrics.keyLight,
        minimumDayPixels: Math.min(...visual.metrics.samples.filter((sample) => sample.phase === 'daytime').map((sample) => sample.pixels)),
        unmeasured: visual.metrics.unmeasured } : null;
      if (action === 'continue') { stageIndex++; previous = { action, diff: result.diff, hard, visual: visualSummary, critique: review }; continue; }
      if (['request-input', 'stop', 'refine-spec'].includes(action)) { stopReason = `Critic requested ${action}; spec is not silently changed`; break; }
      previous = { action, diff: result.diff, failures: blockers.slice(0, 15), hard: hard.metrics, visual: visualSummary, critique: review };
      if ((stageCorrections[stage] || 0) >= bible.rules.loop.maxCorrectionsPerStage || corrections >= bible.rules.loop.maxCorrectionsGlobal || round >= roundLimit) {
        stopReason = 'Bounded correction limit reached'; break;
      }
      corrections++; stageCorrections[stage] = (stageCorrections[stage] || 0) + 1;
      round++;
    }
    if (!stopReason) stopReason = loopOff ? 'Loop-off baseline: one generation, no revision' : stageIndex === stages.length ? 'All stages completed; human review still required' : 'Round limit reached';
    if (best) await writeFile(recipePath(spec), json(best.recipe));
    if (best?.sheet) {
      await mkdir(evidenceDirectory, { recursive: true });
      await copyFile(join(root, best.sheet), join(evidenceDirectory, `${spec.id}-recipe-sheet.png`));
    }
    const usageEntries = history.flatMap((item) => [item.generatorUsage, item.criticUsage]).filter(Boolean);
    const sessionCount = history.reduce((sum, item) => sum + Number(!!item.generatorSession) + Number(!!item.criticSession), 0);
    const totalUsage = usageEntries.length ? {
      input: usageEntries.reduce((sum, item) => sum + (item.tokens.input || 0), 0),
      output: usageEntries.reduce((sum, item) => sum + (item.tokens.output || 0), 0),
      reasoning: usageEntries.reduce((sum, item) => sum + (item.tokens.reasoning || 0), 0),
      reportedCostUSD: usageEntries.length === sessionCount && usageEntries.every((item) => item.cost !== null) ? usageEntries.reduce((sum, item) => sum + item.cost, 0) : null,
      sessionsWithUsage: usageEntries.length, sessionCount, complete: usageEntries.length === sessionCount,
    } : null;
    // Reaching the fourth round is always needs-human, even if its last review
    // happens to say continue. A pass is only an automated gate, not Look Dev signoff.
    const status = !loopOff && stageIndex === stages.length && round < bible.rules.loop.maxRounds ? 'PASSED' : 'needs-human';
    if (best) await writeFile(join(run, 'best.json'), json({ status, ...best }));
    const final = { id: spec.id, category: spec.category, status, signedBy: null, roundsUsed: round,
      loopMode: loopOff ? 'off-one-generation' : 'on-bounded',
      completedStages: stages.slice(0, stageIndex), corrections, stageCorrections, stopReason, best,
      imageProbe: probe?.imageReadingObserved && process.env.ASSETGEN_IMAGES !== '0' ? 'three colour probes passed' : 'visual critique not run',
      criticModelIds: [...new Set(history.map((item) => item.criticModelId).filter(Boolean))],
      lighting: 'merged EBR-80, human review still required', wallTimeMs: Date.now() - first, usage: totalUsage,
      tokenCostNote: 'Usage/cost are OpenCode session-reported values when available; missing sessions are not estimated.', history };
    await writeFile(join(run, 'final.json'), json(final));
    console.log(`${spec.id}: ${status} · ${stageIndex}/${stages.length} stages · ${stopReason}`);
    if (!best) process.exitCode = 1;
  } finally { await runner.close(); }
}

async function verifyCommand(input) {
  if (!input) throw new Error('Usage: npm run asset:verify -- <id|all>');
  const candidates = input === 'all' ? await listSpecs() : [await readSpec(input)];
  const { bible, runner, environment } = await setup();
  try {
    let count = 0;
    for (const { spec } of candidates) {
      let recipe;
      try {
        const best = JSON.parse(await readFile(join(runDirectory, spec.id, 'best.json'), 'utf8'));
        recipe = best.recipe;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try { recipe = JSON.parse(await readFile(recipePath(spec), 'utf8')); }
        catch (missing) { if (input === 'all' && missing.code === 'ENOENT') continue; throw missing; }
      }
      count++;
      await mkdir(join(runDirectory, spec.id), { recursive: true });
      await writeFile(recipePath(spec), json(recipe));
      const result = inspectRecipe(recipe, spec, bible.rules, environment);
      const provenance = { specHash: hash(JSON.stringify(spec)), bibleHash: hash(bible.text), recipeHash: hash(JSON.stringify(recipe)) };
      console.log(json({ id: spec.id, hard: { failures: result.failures, metrics: result.metrics } }));
      const verificationDir = join(runDirectory, spec.id, 'verify');
      await mkdir(verificationDir, { recursive: true });
      if (result.failures.length) {
        await writeFile(join(verificationDir, 'report.json'), json({ id: spec.id, status: 'needs-human', ...provenance, hard: { failures: result.failures, metrics: result.metrics }, visual: 'not run; hard gate failed' }));
        process.exitCode = 1; continue;
      }
      const visual = await runner.capture(spec, bible.rules, verificationDir, recipe);
      await writeFile(join(verificationDir, 'report.json'), json({ id: spec.id, status: 'needs-human', ...provenance, hard: { failures: result.failures, metrics: result.metrics }, visual,
        critiqueStatus: 'not rerun by asset:verify; see the original independent critic session' }));
      console.log(json({ id: spec.id, visual }));
      if (visual.failures.length) process.exitCode = 1;
    }
    if (!count) throw new Error('No bake-off candidates found');
  } finally { await runner.close(); }
}

const [command, input, ...args] = process.argv.slice(2);
try {
  if (command === 'new') await newAsset(input, args);
  else if (command === 'verify') await verifyCommand(input);
  else if (command === 'bundle') throw new Error('Bundle disabled: bake-off only; EBR-80 and Look Dev signoff are required.');
  else throw new Error(`Unknown assetgen command ${command || ''}`);
} catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
