import { mkdir, mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { evidenceDirectory, listSpecs, readBible, readSpec, readVisionProbe, recipePath, root, runDirectory, variantReferences } from './config.mjs';
import { inspectRecipe } from './geometry.mjs';
import { fitGeneratedRecipe } from './fit-generated.mjs';
import { critiqueRecipe, generateRecipe, generatorAttachment, makePrompt, revisionFeedback } from './generator.mjs';
import { loadPriorReview } from './prior-review.mjs';
import { createVisualRunner } from './visual.mjs';
import { isBetterCandidate } from './scoring.mjs';
import { isolatedSessionDirectory } from './opencode.mjs';
import { loadFixtures } from './fixtures.mjs';
import { auditBundleEntry, verifierSourceHash } from './bundle.mjs';
import { createSignedFixtures, inspectSignedFixture, signedS2LegacyReason } from './signed-fixtures.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const digestParts = (before, after) => {
  const old = new Map((before?.parts || []).map((part) => [part.name, JSON.stringify(part)]));
  const next = new Map((after?.parts || []).map((part) => [part.name, JSON.stringify(part)]));
  return { added: [...next.keys()].filter((key) => !old.has(key)), removed: [...old.keys()].filter((key) => !next.has(key)),
    changed: [...next.keys()].filter((key) => old.has(key) && old.get(key) !== next.get(key)) };
};

async function verifySigned(name, runner, environment, bible, output) {
  const fixtures = await createSignedFixtures(runner.server);
  if (!fixtures.names.includes(name)) throw new Error(`Unknown signed fixture ${name}`);
  const baseline = JSON.parse(await readFile(join(root, 'tools/assetgen/signed-baselines.json'), 'utf8'));
  const result = inspectSignedFixture(name, fixtures.build(name), fixtures.build(name), bible.rules, environment.palette, baseline);
  result.metrics.a9Calibration = await runner.calibration(bible.rules);
  if (result.failures.length) return result;
  const target = fixtures.expected[name];
  const spec = { id: `signed-${name}`, category: target.category,
    size: { width: target.size[0], height: target.size[1], depth: target.size[2] }, identityFeatures: [] };
  const visual = await runner.capture(spec, bible.rules, join(output, name), null, { signedFixture: name, jitter: true });
  const jitter = visual.metrics?.jitter || [];
  const checked = jitter.reduce((sum, item) => sum + item.checkedPixels, 0);
  const skippedEdges = jitter.reduce((sum, item) => sum + item.skippedEdgePixels, 0);
  const flicker = jitter.reduce((sum, item) => sum + item.flickerCandidates, 0);
  result.failures.push(...visual.failures.filter((failure) => failure.code === 'PIXEL_RENDER'));
  if (visual.failures.some((failure) => failure.code === 'BROWSER') || jitter.length !== 24 || !checked) {
    result.failures.push({ code: 'A7_UNMEASURED', message: 'Signed jitter/turntable could not be measured' });
  } else if (flicker) {
    result.failures.push({ code: 'A7_FLICKER', message: `${flicker} unmatched pixel changes across 24 jittered yaws` });
  }
  result.metrics.empiricalJitter = { views: jitter.length, checkedPixels: checked, skippedEdgePixels: skippedEdges, flickerCandidates: flicker,
    differingViews: jitter.filter((item) => item.flickerCandidates) };
  result.metrics.a9Calibration = visual.metrics?.a9Calibration;
  result.metrics.a9FloorMode = visual.metrics?.a9FloorMode;
  result.metrics.phaseLighting = visual.metrics?.phaseLighting;
  if (visual.metrics?.samples) {
    result.metrics.s2ByPhase = Object.fromEntries([...new Set(visual.metrics.samples.map((sample) => sample.phase))].map((phase) => {
      const samples = visual.metrics.samples.filter((sample) => sample.phase === phase);
      return [phase, { minimumContrastRatio: Math.min(...samples.map((sample) => sample.meanContrastRatio)),
        minimumDeltaE: Math.min(...samples.map((sample) => sample.meanDeltaE)), minimumPixels: Math.min(...samples.map((sample) => sample.pixels)) }];
    }));
  }
  for (const warning of result.warnings) if (warning.code === 'A7_ANALYTIC_WARNING') {
    warning.message += `; 24-yaw interior jitter found ${flicker} candidates, with ${skippedEdges} edge pixels excluded`;
  }
  const legacyReason = signedS2LegacyReason(name, result.metrics.hashes[0]);
  const s2Failures = visual.failures.filter((failure) => failure.code === 'S2');
  if (legacyReason && s2Failures.length) {
    result.warnings.push({ code: 'SIGNED_S2_LEGACY', message: legacyReason });
    result.warnings.push(...s2Failures.map((failure) => ({ ...failure, code: 'SIGNED_S2_WARNING' })));
  } else result.failures.push(...s2Failures);
  result.failures.push(...visual.failures.filter((failure) => !['BROWSER', 'PIXEL_RENDER', 'A7_UNMEASURED', 'A7_FLICKER', 'S2'].includes(failure.code)));
  result.warnings.push(...(visual.warnings || []).map((warning) => ({ ...warning, code: `SIGNED_${warning.code}_WARNING` })));
  result.status = result.failures.length ? 'FAIL' : 'PASS';
  result.notChecked = ['A7 excluded silhouette-edge pixels', 'A11 placement', 'A12 walking shimmer', 'A13 Look Dev'];
  result.evidence = join(output, name);
  return result;
}

async function setup() {
  const bible = await readBible();
  const runner = await createVisualRunner();
  try {
    const calibration = await runner.calibration(bible.rules);
    const { buildRecipe } = await runner.server.ssrLoadModule('/src/assets/buildRecipe.ts');
    const { ASSET_PALETTE, ACCENT_TOKENS } = await runner.server.ssrLoadModule('/src/assets/palette.ts');
    const probe = await readVisionProbe();
    return { bible, runner, calibration, environment: { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS }, probe };
  } catch (error) { await runner.close(); throw error; }
}

function score(hard, visual, critic) {
  const hardCodes = new Set(hard.failures.map((failure) => failure.code));
  if (hardCodes.size) return Math.max(0, 35 - hardCodes.size * 7);
  const visualCodes = new Set((visual?.failures || []).map((failure) => failure.code));
  const criticMean = critic?.scores ? Object.values(critic.scores).reduce((sum, value) => sum + value, 0) / 30 * 100 : 0;
  return Math.max(0, Math.round((criticMean || 50) * 0.6 + 40 - visualCodes.size * 8));
}

async function newAsset(input, args) {
  if (!input) throw new Error('Usage: npm run asset:new -- <spec.json|id> [--work-order|--loop-off|--prior-review <report.json> [--review-plan <notes.md>]]');
  const priorIndex = args.indexOf('--prior-review');
  if (priorIndex !== -1 && (!args[priorIndex + 1] || args[priorIndex + 1].startsWith('--') ||
      args.lastIndexOf('--prior-review') !== priorIndex || args.includes('--loop-off') || args.includes('--work-order'))) {
    throw new Error('--prior-review needs one report path and cannot be combined with --loop-off or --work-order');
  }
  const planIndex = args.indexOf('--review-plan');
  if (planIndex !== -1 && (priorIndex === -1 || !args[planIndex + 1] || args[planIndex + 1].startsWith('--') || args.lastIndexOf('--review-plan') !== planIndex)) {
    throw new Error('--review-plan needs one notes path and --prior-review');
  }
  const { spec, path: specPath } = await readSpec(input);
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
  const { bible, runner, calibration, environment, probe } = context;
  environment.referenceRecipes = {};
  for (const referenceId of variantReferences(spec)) {
    try {
      const reference = JSON.parse(await readFile(join(runDirectory, referenceId, 'best.json'), 'utf8'));
      environment.referenceRecipes[referenceId] = reference.recipe;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const sessionDir = await isolatedSessionDirectory();
  try {
    const specBytes = await readFile(specPath, 'utf8');
    const planPath = planIndex === -1 ? null : resolve(args[planIndex + 1]);
    const prior = priorIndex === -1 ? null : await loadPriorReview(args[priorIndex + 1], spec, specBytes, bible.text,
      planPath ? { planText: await readFile(planPath, 'utf8'), planPath } : {});
    if (prior) await writeFile(join(run, 'prior-review.json'), json({ ...prior.provenance, feedback: prior.feedback }));
    const first = Date.now();
    let round = 1, corrections = 0, stageIndex = 0;
    let current = prior?.recipe ?? null, previous = prior?.feedback ?? null, best = null, stopReason = null;
    let previousSheet = null;
    const verifierHash = await verifierSourceHash();
    const stageCorrections = {};
    const history = [];
    const loopOff = args.includes('--loop-off');
    const stages = loopOff ? ['blockout'] : bible.rules.loop.stages;
    const roundLimit = loopOff ? 1 : bible.rules.loop.maxRounds;
    while (round <= roundLimit && stageIndex < stages.length) {
      const stage = stages[stageIndex];
      const stageDir = join(run, `round-${round}`, `stage-${stage}`);
      await mkdir(stageDir, { recursive: true });
      const prompt = await makePrompt(spec, bible, stage, current, previous, best?.recipe, environment.referenceRecipes);
      await writeFile(join(stageDir, 'prompt.txt'), prompt);
      let generated;
      try {
        generated = await generateRecipe(prompt, sessionDir, generatorAttachment(probe, previousSheet));
        await writeFile(join(stageDir, 'generator.jsonl'), generated.transcript);
      } catch (error) {
        const message = String(error);
        await writeFile(join(stageDir, 'generation-error.txt'), `${message}\n`);
        if (error?.stdout) await writeFile(join(stageDir, 'generation-error.jsonl'), error.stdout);
        previous = { failures: [{ code: 'GENERATOR', message }], instruction: 'Retry the JSON generation/build with the exact error.' };
        history.push({ round, stage, action: 'refine-code', failure: message });
        const quota = /provider\.free-limit|QuotaExceeded|Free usage limit/i.test(message);
        if (quota || (stageCorrections[stage] || 0) >= bible.rules.loop.maxCorrectionsPerStage || corrections >= bible.rules.loop.maxCorrectionsGlobal || round >= roundLimit) {
          stopReason = quota ? 'Free model quota exhausted; work order emitted' : 'Generation retries exhausted';
          await writeFile(join(run, 'work-order.md'), `${prompt}\n\nSave JSON to ${relative(root, recipePath(spec))}, then run npm run asset:verify -- ${spec.id}.\n`);
          break;
        }
        corrections++; stageCorrections[stage] = (stageCorrections[stage] || 0) + 1;
        round++; continue;
      }
      const old = current;
      const fitted = fitGeneratedRecipe(generated.recipe, spec, bible.rules, environment);
      current = fitted.recipe;
      if (fitted.normalization) await writeFile(join(stageDir, 'generated-recipe.json'), json(generated.recipe));
      await writeFile(recipePath(spec), json(current));
      await writeFile(join(stageDir, 'recipe.json'), json(current));
      const inspected = inspectRecipe(current, spec, bible.rules, environment);
      const hard = { failures: inspected.failures, metrics: inspected.metrics };
      let visual = null, review = null, criticSession = null, criticModelId = null, criticDurationMs = null, criticUsage = null, criticTranscript = null, criticError = null;
      if (!hard.failures.length) {
        visual = await runner.capture(spec, bible.rules, join(stageDir, 'render'), current, { jitter: true }); // Only after the hard gate.
        const sheet = join(stageDir, 'render/sheet.png');
        if (process.env.ASSETGEN_IMAGES !== '0' && probe?.imageReadingObserved && !visual.failures.some((failure) => failure.code === 'BROWSER')) {
          try {
            const result = await critiqueRecipe(spec, bible, stage, { hard, visual }, sheet, sessionDir);
            criticSession = result.sessionId;
            criticModelId = result.modelId;
            criticDurationMs = result.durationMs;
            criticUsage = result.usage;
            criticTranscript = result.transcript;
            await writeFile(join(stageDir, 'critic.jsonl'), result.transcript);
            await writeFile(join(stageDir, 'critic-prompt.txt'), result.prompt);
            review = result.review;
            if (!criticSession || criticSession === generated.sessionId || !criticModelId) throw new Error('Critic needs a distinct session and recorded model id');
            const canonicalModel = (id) => id.replace(/#default$/, '');
            const probedModels = new Set(probe.trials?.filter((trial) => trial.correct && trial.modelId).map((trial) => canonicalModel(trial.modelId)) || []);
            if (!probedModels.has(canonicalModel(criticModelId))) throw new Error(`Critic model ${criticModelId} has not passed the image probe`);
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
        a9Calibration: visual?.metrics?.a9Calibration ?? calibration, warnings: visual?.warnings ?? [],
        specHash: hash(specBytes), bibleHash: hash(bible.text), recipeHash: hash(json(current)), verifierHash, hard, visual, critique: review,
        critiqueStatus: criticError || (review?.imageReviewed ? 'independent visual critique recorded' : 'visual critique not run'),
        generatorSession: generated.sessionId, generatorModelId: generated.modelId, criticSession, criticModelId,
        generatorReceiptHash: hash(generated.transcript), criticReceiptHash: criticTranscript ? hash(criticTranscript) : null,
        generatorDurationMs: generated.durationMs, criticDurationMs, normalization: fitted.normalization,
        generatorUsage: generated.usage, criticUsage, diff: digestParts(old, current), blockers };
      await writeFile(join(stageDir, 'report.json'), json(result));
      history.push({ round, stage, action, score: stageScore, blockers: blockers.map((item) => item.code),
        generatorSession: generated.sessionId, generatorModelId: generated.modelId, criticSession, criticModelId,
        imageReviewed: review?.imageReviewed === true && !criticError, critiqueStatus: result.critiqueStatus, generatorUsage: generated.usage, criticUsage });
      const candidate = { score: stageScore, recipe: current, stage, round, hardFailureCount: hard.failures.length,
        lowerTrust: !!hard.metrics.lowerTrust, blockers, normalization: fitted.normalization, report: relative(root, join(stageDir, 'report.json')),
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
      previous = revisionFeedback({ action, diff: result.diff, hard, blockers, visual: visualSummary, critique: review });
      if ((stageCorrections[stage] || 0) >= bible.rules.loop.maxCorrectionsPerStage || corrections >= bible.rules.loop.maxCorrectionsGlobal || round >= roundLimit) {
        stopReason = 'Bounded correction limit reached'; break;
      }
      corrections++; stageCorrections[stage] = (stageCorrections[stage] || 0) + 1;
      round++;
    }
    if (!stopReason) stopReason = loopOff ? 'Loop-off baseline: one generation, no revision' : stageIndex === stages.length ? 'All stages completed; human review still required' : 'Round limit reached';
    if (best) await writeFile(recipePath(spec), json(best.recipe));
    if (best?.sheet) {
      const output = join(evidenceDirectory, 'ebr83-85', loopOff ? 'loop-off' : 'loop-on');
      await mkdir(output, { recursive: true });
      await copyFile(join(root, best.sheet), join(output, `${spec.id}-recipe-sheet.png`));
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
    const status = !loopOff && stageIndex === stages.length && round < bible.rules.loop.maxRounds && best?.stage === 'optimise' ? 'PASSED' : 'needs-human';
    if (best) await writeFile(join(run, 'best.json'), json({ status, ...best }));
    const bestReport = best ? JSON.parse(await readFile(join(root, best.report), 'utf8')) : null;
    const final = { id: spec.id, category: spec.category, status, signedBy: null, roundsUsed: round,
      a9Calibration: bestReport?.a9Calibration ?? calibration,
      loopMode: loopOff ? 'off-one-generation' : 'on-bounded',
      specHash: hash(specBytes), bibleHash: hash(bible.text), recipeHash: best ? hash(json(best.recipe)) : null, verifierHash,
      generatorSession: bestReport?.generatorSession ?? null, criticSession: bestReport?.criticSession ?? null,
      criticModelId: bestReport?.criticModelId ?? null, critique: bestReport?.critique ?? null,
      generatorReceiptHash: bestReport?.generatorReceiptHash ?? null, criticReceiptHash: bestReport?.criticReceiptHash ?? null,
      completedStages: stages.slice(0, stageIndex), corrections, stageCorrections, stopReason, best,
      imageProbe: probe?.imageReadingObserved && process.env.ASSETGEN_IMAGES !== '0' ? 'three colour probes passed' : 'visual critique not run',
      criticModelIds: [...new Set(history.map((item) => item.criticModelId).filter(Boolean))],
      visualCritiqueStatus: history.some((item) => item.imageReviewed) ? 'image reviewed for one or more stages; see history' : 'visual critique not run',
      lighting: 'merged EBR-80, human review still required', wallTimeMs: Date.now() - first, usage: totalUsage,
      tokenCostNote: 'Usage/cost are OpenCode session-reported values when available; missing sessions are not estimated.', history };
    await writeFile(join(run, 'final.json'), json(final));
    console.log(`${spec.id}: ${status} · ${stageIndex}/${stages.length} stages · ${stopReason}`);
    if (!best) process.exitCode = 1;
  } finally { await runner.close(); }
}

async function verifyExternal(directory, selectedId) {
  const fixtures = await loadFixtures(directory);
  const references = Object.fromEntries(fixtures.filter((item) => item.spec && item.recipe).map((item) => [item.spec.id, item.recipe]));
  const selected = selectedId ? fixtures.filter((item) => item.name === selectedId || item.spec?.id === selectedId) : fixtures;
  if (!selected.length) throw new Error(`Fixture not found: ${selectedId}`);
  const { bible, runner, calibration, environment } = await setup();
  const output = await mkdtemp(join(tmpdir(), 'assetgen-external-verify-'));
  try {
    for (const fixture of selected) {
      if (fixture.error) {
        console.log(json({ id: fixture.name, status: 'FAIL', failures: [fixture.error], a9Calibration: calibration }));
        process.exitCode = 1;
        continue;
      }
      if (fixture.signed) {
        const result = await verifySigned(fixture.signed, runner, environment, bible, output);
        console.log(json({ id: fixture.name, ...result }));
        if (result.status !== 'PASS') process.exitCode = 1;
        continue;
      }
      const { spec, recipe } = fixture;
      const hard = inspectRecipe(recipe, spec, bible.rules, { ...environment, referenceRecipes: references });
      let visual = null;
      if (!hard.failures.length) visual = await runner.capture(spec, bible.rules, join(output, spec.id), recipe, { jitter: true });
      const failures = [...hard.failures, ...(visual?.failures || [])];
      const result = { id: spec.id, status: failures.length ? 'FAIL' : 'PASS_HARD_AND_MEASURED_VISUAL', failures,
        warnings: visual?.warnings ?? [], a9Calibration: visual?.metrics?.a9Calibration ?? calibration,
        hard: { failures: hard.failures, metrics: hard.metrics }, visual, output: visual ? join(output, spec.id) : null,
        note: 'No model call or Look Dev signoff; unmeasured checks do not become passes.' };
      console.log(json(result));
      if (failures.length) process.exitCode = 1;
    }
  } finally { await runner.close(); }
}

async function verifyCommand(input, args) {
  const options = [input, ...args].filter(Boolean);
  if (options.includes('--calibrate')) {
    if (options.length !== 1) throw new Error('--calibrate does not accept other arguments');
    const bible = await readBible();
    const runner = await createVisualRunner();
    try { console.log(json({ a9Calibration: await runner.recalibrate(bible.rules) })); }
    finally { await runner.close(); }
    return;
  }
  if (options.includes('--signed')) {
    const name = options[options.indexOf('--signed') + 1];
    if (!name || name.startsWith('--')) throw new Error('--signed requires tree, coop, fence, tread or all');
    const { bible, runner, environment } = await setup();
    const output = await mkdtemp(join(tmpdir(), 'assetgen-signed-verify-'));
    try {
      for (const fixture of name === 'all' ? ['tree', 'coop', 'fence', 'tread'] : [name]) {
        const result = await verifySigned(fixture, runner, environment, bible, output);
        console.log(json({ id: fixture, ...result }));
        if (result.status !== 'PASS') process.exitCode = 1;
      }
    } finally { await runner.close(); }
    return;
  }
  if (options.includes('--dir')) {
    const directory = options[options.indexOf('--dir') + 1];
    const selected = options.includes('--id') ? options[options.indexOf('--id') + 1] : undefined;
    if (!directory || directory.startsWith('--') || (options.includes('--id') && (!selected || selected.startsWith('--')))) throw new Error('--dir and --id require values');
    return verifyExternal(directory, selected);
  }
  if (input === '--id') input = args[0];
  if (!input) throw new Error('Usage: npm run asset:verify -- <id|all>');
  const candidates = input === 'all' ? await listSpecs() : [await readSpec(input)];
  const { bible, runner, calibration, environment } = await setup();
  try {
    environment.referenceRecipes = {};
    for (const { spec } of candidates) for (const referenceId of variantReferences(spec)) {
      try { environment.referenceRecipes[referenceId] = JSON.parse(await readFile(join(runDirectory, referenceId, 'candidate.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let count = 0;
    for (const { spec, path: specPath } of candidates) {
      let recipe;
      let recipeBytes;
      try {
        recipeBytes = await readFile(recipePath(spec), 'utf8');
        recipe = JSON.parse(recipeBytes);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (input === 'all') continue;
        throw error;
      }
      count++;
      await mkdir(join(runDirectory, spec.id), { recursive: true });
      const result = inspectRecipe(recipe, spec, bible.rules, environment);
      const provenance = { specHash: hash(await readFile(specPath, 'utf8')), bibleHash: hash(bible.text), recipeHash: hash(recipeBytes), verifierHash: await verifierSourceHash() };
      console.log(json({ id: spec.id, a9Calibration: calibration, hard: { failures: result.failures, metrics: result.metrics } }));
      const verificationDir = join(runDirectory, spec.id, 'verify');
      await mkdir(verificationDir, { recursive: true });
      if (result.failures.length) {
        await writeFile(join(verificationDir, 'report.json'), json({ id: spec.id, status: 'needs-human', ...provenance, a9Calibration: calibration, hard: { failures: result.failures, metrics: result.metrics }, visual: 'not run; hard gate failed' }));
        process.exitCode = 1; continue;
      }
      const visual = await runner.capture(spec, bible.rules, verificationDir, recipe, { jitter: true });
      await writeFile(join(verificationDir, 'report.json'), json({ id: spec.id, status: 'needs-human', ...provenance, a9Calibration: visual.metrics?.a9Calibration ?? calibration, hard: { failures: result.failures, metrics: result.metrics }, visual,
        critiqueStatus: 'not rerun by asset:verify; see the original independent critic session' }));
      console.log(json({ id: spec.id, visual }));
      if (visual.failures.length) process.exitCode = 1;
    }
    if (!count) throw new Error('No bake-off candidates found');
  } finally { await runner.close(); }
}

async function bundleCommand(args) {
  const dirIndex = args.indexOf('--dir');
  let fixtures;
  if (dirIndex !== -1) {
    if (!args[dirIndex + 1]) throw new Error('--dir requires a fixture directory');
    fixtures = await loadFixtures(args[dirIndex + 1]);
  } else {
    fixtures = [];
    for (const { spec, path: specPath } of await listSpecs()) {
      const dir = join(runDirectory, spec.id);
      try {
        const reportBytes = await readFile(join(dir, 'final.json'), 'utf8');
        const report = JSON.parse(reportBytes);
        let recipe, recipeBytes;
        try { recipeBytes = await readFile(join(dir, 'candidate.json'), 'utf8'); recipe = JSON.parse(recipeBytes); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          fixtures.push({ name: spec.id, error: { code: 'SOURCE_MISSING', message: `${report.status}: no generated candidate` } });
          continue;
        }
        let signoff = null, signoffBytes = null;
        try { signoffBytes = await readFile(join(dir, 'signoff.json'), 'utf8'); signoff = JSON.parse(signoffBytes); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        let generator = null, critic = null, generatorPath = null, criticPath = null;
        if (Number.isInteger(report.best?.round) && report.best.round > 0 && report.best.round <= 4 &&
            ['blockout', 'form', 'material', 'detail', 'lighting', 'optimise'].includes(report.best.stage)) {
          const stageDir = join(dir, `round-${report.best.round}`, `stage-${report.best.stage}`);
          generatorPath = join(stageDir, 'generator.jsonl'); criticPath = join(stageDir, 'critic.jsonl');
          try { generator = await readFile(generatorPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          try { critic = await readFile(criticPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        fixtures.push({ name: spec.id, spec, recipe, recipeBytes, specBytes: await readFile(specPath, 'utf8'), report, reportBytes, signoff, signoffBytes,
          receipts: { generator, critic }, sourcePaths: { spec: specPath, recipe: join(dir, 'candidate.json'), report: join(dir, 'final.json'),
            signoff: join(dir, 'signoff.json'), generator: generatorPath, critic: criticPath } });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  if (!fixtures.length) throw new Error('No candidates; nothing can be bundled');
  const { bible, runner, calibration, environment } = await setup();
  const sourceHash = await verifierSourceHash();
  const references = Object.fromEntries(fixtures.filter((item) => item.spec && item.recipe).map((item) => [item.spec.id, item.recipe]));
  const output = await mkdtemp(join(tmpdir(), 'assetgen-bundle-check-'));
  const accepted = [], auditedInputs = [];
  try {
    for (const item of fixtures) {
      if (item.error) { console.error(`${item.name}: ${item.error.code}: ${item.error.message}`); process.exitCode = 1; continue; }
      if (item.signed) { console.error(`${item.name}: signed reference fixtures are not bundle candidates`); process.exitCode = 1; continue; }
      const result = await auditBundleEntry({ ...item, bible, environment: { ...environment, referenceRecipes: references }, sourceHash,
        render: (recipe, spec) => runner.capture(spec, bible.rules, join(output, spec.id), recipe, { jitter: true }) });
      if (!result.failures.length) auditedInputs.push(item);
      console.log(json({ id: item.spec.id, status: result.status, failures: result.failures, hashes: result.hashes,
        a9Calibration: result.visual?.metrics?.a9Calibration ?? calibration }));
      if (result.failures.length) process.exitCode = 1;
      else accepted.push({ id: item.spec.id, category: item.spec.category, ...result.hashes });
    }
    if (!process.exitCode) for (const item of auditedInputs) {
      const [specBytes, recipeBytes, reportBytes, signoffBytes, generator, critic, currentBible, currentVerifier] = await Promise.all([
        readFile(item.sourcePaths.spec, 'utf8'), readFile(item.sourcePaths.recipe, 'utf8'), readFile(item.sourcePaths.report, 'utf8'),
        readFile(item.sourcePaths.signoff, 'utf8'), readFile(item.sourcePaths.generator, 'utf8'), readFile(item.sourcePaths.critic, 'utf8'),
        readBible(), verifierSourceHash(),
      ]);
      if (specBytes !== item.specBytes || recipeBytes !== item.recipeBytes || reportBytes !== item.reportBytes || signoffBytes !== item.signoffBytes ||
          generator !== item.receipts.generator || critic !== item.receipts.critic ||
          currentBible.text !== bible.text || currentVerifier !== sourceHash) {
        console.error(`${item.spec.id}: HASH_MISMATCH: inputs changed during bundle verification`);
        process.exitCode = 1;
      }
    }
    if (!process.exitCode) {
      // Review manifest only. This PR never writes runtime registry entries.
      await writeFile(join(output, 'manifest.json'), json({ version: 1, assets: accepted }));
      console.log(`Review-only manifest: ${join(output, 'manifest.json')}`);
    } else console.error('Bundle refused; no manifest or runtime entries were written.');
  } finally { await runner.close(); }
}

const [command, input, ...args] = process.argv.slice(2);
try {
  if (command === 'new') await newAsset(input, args);
  else if (command === 'verify') await verifyCommand(input, args);
  else if (command === 'bundle') await bundleCommand([input, ...args].filter(Boolean));
  else throw new Error(`Unknown assetgen command ${command || ''}`);
} catch (error) { console.error(error?.stack || error); process.exitCode = 1; }
