import { createHash } from 'node:crypto';
import { fitGeneratedRecipe } from './fit-generated.mjs';
import { parseJson } from './generator.mjs';
import { textEvents } from './opencode.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const canonicalModel = (id) => String(id || '').replace(/#default$/, '');

function receipt(data, session, expectedHash) {
  if (typeof data !== 'string' || hash(data) !== expectedHash) return null;
  const { events, text } = textEvents(data);
  const ids = new Set(events.map((event) => event.sessionID).filter(Boolean));
  if (ids.size !== 1 || !ids.has(session)) return null;
  try { return parseJson(text); } catch { return null; }
}

/** Review readiness is not a bundle pass or Look Dev signoff. Unimplemented
 * checks remain explicitly unmeasured; every implemented gate must be clear. */
export function assessReviewReadiness({ spec, specBytes, recipeBytes, bible, sourceHash, final, stage, verification, receipts, probe, environment }) {
  const reasons = [], seen = new Set();
  const add = (code, message) => { const key = `${code}\0${message}`; if (!seen.has(key)) { seen.add(key); reasons.push({ code, message }); } };
  if (!final || typeof recipeBytes !== 'string') {
    add('NO_CANDIDATE', final?.stopReason || 'No completed candidate is available.');
    return { ready: false, reasons, unmeasured: ['Visual checks and critic not established'], signed: false };
  }
  let recipe;
  try { recipe = JSON.parse(recipeBytes); } catch { add('PROVENANCE', 'Candidate JSON is invalid.'); return { ready: false, reasons, unmeasured: [], signed: false }; }
  if (typeof specBytes !== 'string' || typeof bible?.text !== 'string' || !bible?.rules?.render) {
    add('PROVENANCE', 'Spec or style-bible bytes are unavailable.');
    return { ready: false, reasons, unmeasured: [], signed: false };
  }
  const expected = { specHash: hash(specBytes), recipeHash: hash(recipeBytes), bibleHash: hash(bible.text), verifierHash: sourceHash };
  for (const [key, value] of Object.entries(expected)) {
    if (!value || final[key] !== value || stage?.[key] !== value || verification?.[key] !== value) add('PROVENANCE', `${key} does not match the candidate, selected stage and offline verifier.`);
  }
  if (!verification || !Array.isArray(verification.hard?.failures)) add('VERIFY_UNAVAILABLE', 'Offline hard verification did not complete.');
  else {
    for (const failure of verification.hard.failures) add(failure.code, failure.message);
    for (let i = 1; i <= 10; i++) if (verification.hard.metrics?.checks?.[`H${i}`] !== true &&
        !verification.hard.failures.some((failure) => failure.code === `H${i}`)) add(`H${i}_UNMEASURED`, `Hard check H${i} was not established.`);
  }
  const visual = verification?.visual;
  if (!visual || typeof visual !== 'object' || !Array.isArray(visual.failures) || !visual.metrics) {
    add('VISUAL_UNAVAILABLE', 'Offline measured visual checks were not run.');
  } else {
    for (const failure of visual.failures) add(failure.code, failure.message);
    const m = visual.metrics, render = bible.rules.render;
    const phases = [...render.phases, ...(render.extraPhases || [])];
    const expectedSamples = phases.length * render.yaws.length * render.surfaces.length;
    const sampleKeys = new Set((Array.isArray(m.samples) ? m.samples : []).filter((sample) => phases.includes(sample.phase) && render.yaws.includes(sample.yaw) && render.surfaces.includes(sample.surface) && Number.isFinite(sample.pixels))
      .map((sample) => `${sample.phase}\0${sample.yaw}\0${sample.surface}`));
    if (!Array.isArray(m.samples) || m.samples.length !== expectedSamples || sampleKeys.size !== expectedSamples) add('S2_UNMEASURED', 'The fixed phase/yaw/surface samples are incomplete.');
    if (!m.pixel?.enabled || m.pixel.canvasWidth !== 320 || m.pixel.canvasHeight !== 180 || m.pixel.cssPixelSize !== 4) add('PIXEL_RENDER', 'The 320×180 pixel pass was not established.');
    if (!Array.isArray(m.jitter) || m.jitter.length !== 24 || m.jitter.some((sample, i) => sample.yaw !== i * 15) || !m.jitter.some((sample) => sample.checkedPixels > 0)) add('A7_UNMEASURED', 'The 24-yaw interior jitter audit is incomplete.');
    if (m.keyLight?.status !== 'pass' || phases.some((phase) => m.phaseLighting?.[phase]?.status !== 'pass')) add('S4_UNMEASURED', 'Key-light agreement is not measured as passing for every phase.');
    const tagged = (Array.isArray(recipe.parts) ? recipe.parts : []).filter((part) => part?.feature);
    for (const phase of phases) {
      for (const feature of spec.identityFeatures) if ((m.featureByPhase?.[phase]?.[feature.id] || []).length !== render.yaws.length) add('IDENTITY_UNMEASURED', `${phase}: ${feature.id} was not measured at every yaw.`);
      for (const part of tagged) if ((m.partByPhase?.[phase]?.[part.name]?.views || []).length !== render.yaws.length) add('IDENTITY_UNMEASURED', `${phase}: ${part.name} was not measured at every yaw.`);
    }
    const treeClass = spec.category === 'flora' && (spec.assetClass === 'tree' || /(?:^|-)(?:tree|oak|pine|fir)(?:-|$)/i.test(spec.id));
    if (m.a9FloorMode === 'tree-by-eye' && !treeClass) add('A9_UNMEASURED', 'Only tree-class flora can use the by-eye A9 path.');
    if (m.a9FloorMode !== 'tree-by-eye') for (const phase of ['daytime', 'morning', 'sunset']) {
      const floor = m.a9Calibration?.floors?.[phase], ratio = m.phaseLighting?.[phase]?.shadeLitRatio;
      if (!Number.isFinite(floor) || !Number.isFinite(ratio)) add('A9_UNMEASURED', `${phase}: calibrated shade ratio is unavailable.`);
      else if (ratio < floor) add('A9_SHADE_RATIO', `${phase}: shade ratio is below the calibrated floor.`);
    }
  }
  if (!stage || stage.critiqueStatus !== 'independent visual critique recorded' || !stage.criticSession ||
      !stage.generatorSession || stage.criticSession === stage.generatorSession || !stage.criticModelId) {
    add('CRITIQUE_UNAVAILABLE', 'A distinct, recorded independent image critic is required.');
  } else {
    const review = stage.critique;
    const trialCount = (probe?.trials || []).filter((trial) => trial.correct && canonicalModel(trial.modelId) === canonicalModel(stage.criticModelId)).length;
    if (!probe?.imageReadingObserved || trialCount < 3) add('CRITIQUE_UNAVAILABLE', 'The critic model lacks three matching passing image-probe trials.');
    const generated = receipt(receipts?.generator, stage.generatorSession, stage.generatorReceiptHash);
    const critiqued = receipt(receipts?.critic, stage.criticSession, stage.criticReceiptHash);
    if (!generated || !critiqued || !same(critiqued, review)) add('RECEIPT', 'Generator or critic receipt does not substantiate the recorded session and critique.');
    else {
      try {
        const fitted = stage.normalization ? fitGeneratedRecipe(generated, spec, bible.rules, environment) : { recipe: generated, normalization: null };
        if (!same(fitted.recipe, recipe) || !same(fitted.normalization, stage.normalization ?? null) || !same(stage.normalization ?? null, final.best?.normalization ?? null)) add('RECEIPT', 'Generator receipt and recorded normalization do not reproduce the candidate.');
      } catch { add('RECEIPT', 'Generator normalization could not be replayed.'); }
    }
    const axes = ['silhouette', 'palette', 'shapeLanguage', 'valueStructure', 'sceneFit', 'craft'];
    if (review?.imageReviewed !== true || !axes.every((axis) => Number.isInteger(review?.scores?.[axis]) && review.scores[axis] >= 4 && review.scores[axis] <= 5) ||
        !spec.identityFeatures.every((feature) => review?.features?.[feature.id] === true) || !Array.isArray(review?.blockers) || review.blockers.length || review.action !== 'continue') {
      const details = [...(Array.isArray(review?.blockers) ? review.blockers : []), ...axes.filter((axis) => !(Number.isInteger(review?.scores?.[axis]) && review.scores[axis] >= 4 && review.scores[axis] <= 5)).map((axis) => `${axis}=${review?.scores?.[axis] ?? 'unmeasured'}`),
        ...spec.identityFeatures.filter((feature) => review?.features?.[feature.id] !== true).map((feature) => `identity not seen: ${feature.id}`), `critic action: ${review?.action ?? 'unavailable'}`];
      add('CRITIQUE', details.join('; '));
    }
  }
  const stageBlockers = Array.isArray(stage?.blockers) ? stage.blockers : [];
  for (const blocker of stageBlockers) if (blocker.code !== 'LIGHTING_UNMEASURED') add(blocker.code, blocker.message);
  if (stage && stage.action !== 'continue' && !(stage.action === 'request-input' && stage.critique?.action === 'continue' &&
      stageBlockers.length > 0 && stageBlockers.every((blocker) => blocker.code === 'LIGHTING_UNMEASURED'))) {
    add('STAGE_ACTION', `Selected stage requested ${stage.action || 'an unavailable action'}.`);
  }
  const unmeasured = Array.isArray(visual?.metrics?.unmeasured) ? visual.metrics.unmeasured : ['Visual checks not established'];
  return { ready: reasons.length === 0, reasons, unmeasured, signed: false,
    note: 'Ready means implemented checks and independent critic cleared for P0 human review only; no signoff or bundle promotion.' };
}
