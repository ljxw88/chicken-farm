import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readBible } from '../tools/assetgen/config.mjs';
import { assessReviewReadiness } from '../tools/assetgen/review-readiness.mjs';

const bible = await readBible(), sha = (text) => createHash('sha256').update(text).digest('hex');
const receipt = (sessionID, value) => `${JSON.stringify({ type: 'text', sessionID, part: { text: JSON.stringify(value) } })}\n`;
const spec = { id: 'review-fixture', category: 'prop', identityFeatures: [{ id: 'body' }, { id: 'cap' }, { id: 'top' }] };
const recipe = { id: spec.id, parts: [{ name: 'body', feature: 'body' }, { name: 'cap', feature: 'cap' }, { name: 'top', feature: 'top' }] };
const specBytes = JSON.stringify(spec), recipeBytes = `${JSON.stringify(recipe, null, 2)}\n`;
const phases = [...bible.rules.render.phases, ...bible.rules.render.extraPhases], yaws = bible.rules.render.yaws;
const views = yaws.map((yaw) => ({ yaw, pixels: 10 }));
const review = { imageReviewed: true, action: 'continue', scores: Object.fromEntries(['silhouette', 'palette', 'shapeLanguage', 'valueStructure', 'sceneFit', 'craft'].map((key) => [key, 4])),
  features: { body: true, cap: true, top: true }, blockers: [], fixes: [] };

function fixture() {
  const hashes = { specHash: sha(specBytes), recipeHash: sha(recipeBytes), bibleHash: sha(bible.text), verifierHash: 'source-hash' };
  const generator = receipt('generator', recipe), critic = receipt('critic', review);
  const stage = { ...hashes, action: 'continue', blockers: [], normalization: null, generatorSession: 'generator', criticSession: 'critic',
    criticModelId: 'opencode/vision-free', generatorReceiptHash: sha(generator), criticReceiptHash: sha(critic),
    critiqueStatus: 'independent visual critique recorded', critique: structuredClone(review) };
  const visual = { failures: [], metrics: { samples: phases.flatMap((phase) => yaws.flatMap((yaw) => bible.rules.render.surfaces.map((surface) => ({ phase, yaw, surface, pixels: 50 })))),
    pixel: { enabled: true, canvasWidth: 320, canvasHeight: 180, cssPixelSize: 4 }, jitter: Array.from({ length: 24 }, (_, i) => ({ yaw: i * 15, checkedPixels: 10 })),
    keyLight: { status: 'pass' }, phaseLighting: Object.fromEntries(phases.map((phase) => [phase, { status: 'pass', shadeLitRatio: 0.8 }])),
    a9FloorMode: 'calibrated', a9Calibration: { floors: { daytime: 0.2, morning: 0.2, sunset: 0.2 } },
    featureByPhase: Object.fromEntries(phases.map((phase) => [phase, Object.fromEntries(spec.identityFeatures.map((feature) => [feature.id, views]))])),
    partByPhase: Object.fromEntries(phases.map((phase) => [phase, Object.fromEntries(recipe.parts.map((part) => [part.name, { views }]))])),
    unmeasured: ['S3 three-step value structure', 'S5 unlit-face glow'] } };
  return { spec, specBytes, recipeBytes, bible, sourceHash: 'source-hash', environment: {},
    final: { ...hashes, status: 'needs-human', best: { normalization: null } }, stage,
    verification: { ...hashes, hard: { failures: [], metrics: { checks: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`H${i + 1}`, true])) } }, visual },
    receipts: { generator, critic }, probe: { imageReadingObserved: true, trials: Array.from({ length: 3 }, () => ({ correct: true, modelId: 'opencode/vision-free#default' })) } };
}

test('implemented verifier and independent critic clearance means human-review readiness, not signoff', () => {
  const input = fixture(), result = assessReviewReadiness(input);
  assert.equal(result.ready, true);
  assert.equal(result.signed, false);
  assert.ok(result.unmeasured.some((item) => item.startsWith('S3')));
  assert.equal(input.final.status, 'needs-human');
});

test('hard failures, critic objections and missing image review cannot pass', () => {
  const hard = fixture(); hard.verification.hard.failures.push({ code: 'H3', message: 'wrong bounds' });
  assert.ok(assessReviewReadiness(hard).reasons.some((reason) => reason.code === 'H3'));
  const critic = fixture(); critic.stage.critique.scores.silhouette = 3; critic.stage.critique.features.body = false; critic.stage.critique.action = 'refine-spec';
  critic.receipts.critic = receipt('critic', critic.stage.critique); critic.stage.criticReceiptHash = sha(critic.receipts.critic);
  const result = assessReviewReadiness(critic);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((reason) => reason.code === 'CRITIQUE' && reason.message.includes('silhouette=3') && reason.message.includes('identity not seen: body')));
  const unavailable = fixture(); unavailable.stage.critiqueStatus = 'visual critique not run';
  assert.ok(assessReviewReadiness(unavailable).reasons.some((reason) => reason.code === 'CRITIQUE_UNAVAILABLE'));
});

test('stale inputs, missing measurements, unprobed critics and forged receipts block readiness', () => {
  for (const mutate of [
    (x) => { x.verification.recipeHash = 'wrong'; },
    (x) => { x.verification.visual.metrics.samples.pop(); },
    (x) => { x.verification.visual.metrics.phaseLighting.sunset.status = 'unmeasured'; },
    (x) => { x.probe.trials[0].correct = false; },
    (x) => { x.receipts.critic += ' '; },
    (x) => { x.stage.criticSession = x.stage.generatorSession; },
  ]) { const input = fixture(); mutate(input); assert.equal(assessReviewReadiness(input).ready, false); }
});

test('unimplemented lighting is disclosed for human review but cannot conceal another blocker', () => {
  const input = fixture(); input.stage.action = 'request-input'; input.stage.blockers = [{ code: 'LIGHTING_UNMEASURED', message: 'S3/S5 not implemented' }];
  assert.equal(assessReviewReadiness(input).ready, true);
  input.stage.blockers.push({ code: 'H7', message: 'overlap' });
  assert.equal(assessReviewReadiness(input).ready, false);
});
