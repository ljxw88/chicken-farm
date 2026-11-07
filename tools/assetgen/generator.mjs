import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root } from './config.mjs';
import { runOpenCode, sessionMetadata, textEvents } from './opencode.mjs';

const references = {
  'signed-tree': 'src/scene/createFarmLayout.ts', 'signed-cottage': 'src/scene/createCottage.ts',
  'signed-coop': 'src/scene/createRampCoop.ts', 'signed-fence': 'src/placement/createPlacementVisual.ts',
  'signed-sign': 'src/scene/createFarmDecorations.ts', 'signed-stairs': 'src/scene/createStoneStairs.ts',
};

function parseJson(text) {
  const block = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i)?.[1] ?? text;
  const start = block.indexOf('{'), end = block.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error(`No JSON object in model response: ${text.slice(0, 1000)}`);
  return JSON.parse(block.slice(start, end + 1));
}

async function run(message, { cwd, attachment, timeout, model } = {}) {
  const args = ['run', '--format', 'json'];
  if (model) args.push('--model', model);
  if (attachment && process.env.ASSETGEN_IMAGES !== '0') args.push('--file', attachment);
  args.push(message);
  const result = await runOpenCode(args, { cwd, timeout });
  const { events, text } = textEvents(result.stdout);
  const errors = events.filter((event) => event.type === 'error');
  if (errors.length || !text.trim()) throw new Error(`OpenCode returned no usable text: ${JSON.stringify(errors)} ${result.stderr}`);
  const sessionId = events.find((event) => event.sessionID)?.sessionID ?? null;
  let metadata = { modelId: null, usage: null };
  if (sessionId) {
    try { metadata = await sessionMetadata(sessionId, cwd); }
    catch { /* A missing endpoint is recorded as unknown, not estimated. */ }
  }
  return { text, transcript: result.stdout, sessionId, durationMs: result.durationMs, ...metadata };
}

// A probed visual critic does not imply the text generator can read images.
export function generatorAttachment(probe, sheet) {
  return process.env.ASSETGEN_GENERATOR_IMAGES === '0' ? null : probe?.imageReadingObserved ? sheet : null;
}

/** Keep the exact validator messages even when other blockers fill the summary. */
export function revisionFeedback({ action, diff, hard, blockers, visual, critique }) {
  const essential = hard.failures.filter((failure) => /jitter/i.test(failure.message) || failure.code === 'VARIANT_SEED');
  const unique = new Map([...blockers.slice(0, 15), ...essential].map((failure) => [`${failure.code}\0${failure.message}`, failure]));
  return { action, diff, failures: [...unique.values()], hard: hard.metrics, visual, critique };
}

function sizeGuidance(spec, rules, previous) {
  const axes = [['width', 'X', 0, spec.size.width], ['height', 'Y', 1, spec.size.height], ['depth', 'Z', 2, spec.size.depth]];
  const format = (value) => Number(value.toFixed(6));
  const lines = axes.map(([name, axis, , target]) =>
    `${name} (${axis}): target ${target}, permitted ${format(target * (1 - rules.dimensionToleranceRelative))}–${format(target * (1 + rules.dimensionToleranceRelative))}`);
  const bounds = previous?.hard?.bounds;
  if (bounds && previous?.failures?.some((failure) => failure.code === 'H3')) {
    lines.push('Previous built bounds, including the parts at each extreme (move/resize geometry, not just metadata):');
    for (const [name, axis, index] of axes) {
      const contributors = (edge) => (previous.hard.partBounds || []).filter((part) =>
        Math.abs(part[edge][index] - bounds[edge][index]) <= 0.0001).map((part) => part.name).join(', ') || 'unknown';
      lines.push(`${name} (${axis}): measured ${bounds[name]}, min ${bounds.min[index]} [${contributors('min')}], max ${bounds.max[index]} [${contributors('max')}]`);
    }
  }
  return `H3 EXACT DIMENSIONS (built geometry AND declared footprint/height must independently fit these ranges):\n${lines.join('\n')}\nExtrudes are centred on at[2], extending depth/2 in both Z directions. Include every transformed part and keep the base at y=0.`;
}

export async function makePrompt(spec, bible, stage, current, previous, best, variantRecipes = {}) {
  const cheat = await readFile(join(root, 'tools/assetgen/recipe-cheatsheet.md'), 'utf8');
  const artBrief = await readFile(join(root, 'docs/asset-lookdev-brief.md'), 'utf8');
  const examples = [];
  for (const id of spec.referenceAssetIds.slice(0, 3)) {
    const path = references[id];
    if (!path) throw new Error(`Unknown signed reference ${id}`);
    examples.push(`SIGNED REFERENCE ${id} (${path}; shapes only, not permission to copy legacy colours):\n${await readFile(join(root, path), 'utf8')}`);
  }
  const dimensions = sizeGuidance(spec, bible.rules, previous);
  const variation = spec.variationSeed === undefined ? '' : `VARIATION SEED ${spec.variationSeed}: on a part use EXACTLY "seed":${spec.variationSeed},"jitter":{"rotation":0.01}. The integer seed is a sibling of jitter, NEVER inside it; jitter permits only scalar position/rotation, never seed/max/rot or arrays. Design a genuinely different silhouette, not a recolour or uniform rescale. This seed controls recipe jitter, not the model's sampling.\n\n`;
  const variantContext = Object.keys(variantRecipes).length ? `OTHER VARIANT RECIPES (make the silhouette distinct from every one):\n${JSON.stringify(variantRecipes, null, 2)}\n\n` : '';
  const jitterErrors = (previous?.failures || []).filter((failure) => /jitter/i.test(failure.message) || failure.code === 'VARIANT_SEED');
  const exactErrors = jitterErrors.length ? `EXACT JITTER VALIDATION ERRORS (fix each one):\n${jitterErrors.map((failure) => `${failure.code}: ${failure.message}`).join('\n')}\n\n` : '';
  return `You are a game-art recipe generator. Do not call tools, edit files, use the network, or output TypeScript. Return ONE complete fenced JSON object. It is automatically built and independently checked.\n\nCURRENT STAGE: ${stage}. ${current ? 'Revise the current recipe only where this stage or the feedback requires; preserve successful geometry.' : 'Create the initial blockout, including a coarse but visible version of every identity feature.'} The six stages are blockout, form, material, detail, lighting and optimise. Every stage must already satisfy H1–H10, the 10% size tolerance, and render every identity feature; do not defer a missing feature to a later stage. No part, band or cleat thinner than 0.1. Round parts use 6–8 segments. Follow the exact spec dimensions. The standard material is already supplied by the builder. Never invent tokens or hexes.\n\n${variation}${exactErrors}${dimensions}\n\nLOOK DEV BRIEF (PM recipe/4-round/no-animal rulings override format advice):\n${artBrief}\n\nSTYLE BIBLE:\n${bible.text}\n\nRECIPE CHEAT SHEET:\n${cheat}\n\nSPEC:\n${JSON.stringify(spec, null, 2)}\n\n${examples.join('\n\n')}\n\n${variantContext}${current ? `CURRENT RECIPE:\n${JSON.stringify(current, null, 2)}` : 'No current recipe.'}\n\n${previous ? `PREVIOUS VERIFICATION / CRITIQUE / CHANGE DIFF (fix the exact named failures):\n${JSON.stringify(previous, null, 2)}` : ''}\n\n${best ? `BEST CANDIDATE SO FAR:\n${JSON.stringify(best, null, 2)}` : ''}\n\n${variation}${exactErrors}${dimensions}\n\nReturn exactly one complete JSON recipe in a fenced json block.`;
}

export async function generateRecipe(prompt, cwd, attachment) {
  const result = await run(prompt, { cwd, attachment, timeout: 240000 });
  return { ...result, recipe: parseJson(result.text) };
}

export async function critiqueRecipe(spec, bible, stage, report, sheet, cwd) {
  const artBrief = await readFile(join(root, 'docs/asset-lookdev-brief.md'), 'utf8');
  const visual = report.visual;
  const compact = { hard: report.hard, visual: { failures: visual?.failures, identityVisibility: visual?.metrics?.identityVisibility,
    featureByPhase: visual?.metrics?.featureByPhase,
    keyLight: visual?.metrics?.keyLight, referenceScale: visual?.metrics?.referenceScale, unmeasured: visual?.metrics?.unmeasured,
    daytimeSamples: visual?.metrics?.samples?.filter((sample) => sample.phase === 'daytime') } };
  const prompt = `You are an independent visual critic, not the generator. Look at the attached contact sheet: eight fixed yaws in each light phase, and signed-farm composites under the merged EBR-80 game lights. Do not claim human approval. The first three rows are 3x crops of the actual 320x180 game render. Judge the current ${stage} stage for recognisable identity, chunky shape, palette fit, value, scene scale and craft. Automated hard failures cannot be overridden. Every identity feature must be visible, not merely named in JSON. Apply every REJECT reason in the Look Dev brief, including wrong style, baked light, unreadable detail and recolour-only variants. Return ONLY JSON: {"imageReviewed":true|false,"scores":{"silhouette":1..5,"palette":1..5,"shapeLanguage":1..5,"valueStructure":1..5,"sceneFit":1..5,"craft":1..5},"features":{"feature-id":true|false,...},"blockers":["specific part and issue"],"fixes":["specific fix"],"action":"continue|refine-spec|refine-code|request-input|stop"}. If the image is not visible set imageReviewed false and do not invent visual claims. Scores are integers. A score below 4, any blocker or any absent identity feature must request revision.\nLOOK DEV BRIEF: ${artBrief}\nSTYLE BIBLE: ${bible.text}\nSPEC: ${JSON.stringify(spec)}\nDETERMINISTIC REPORT: ${JSON.stringify(compact)}`;
  const result = await run(prompt, { cwd, attachment: sheet, timeout: 180000, model: process.env.ASSETGEN_CRITIC_MODEL });
  const review = parseJson(result.text);
  if (process.env.ASSETGEN_IMAGES === '0') review.imageReviewed = false;
  const keys = ['silhouette', 'palette', 'shapeLanguage', 'valueStructure', 'sceneFit', 'craft'];
  if (typeof review.imageReviewed !== 'boolean' || !review.scores || !keys.every((key) => Number.isInteger(review.scores[key]) && review.scores[key] >= 1 && review.scores[key] <= 5) ||
      !review.features || !spec.identityFeatures.every((feature) => typeof review.features[feature.id] === 'boolean') ||
      !Array.isArray(review.blockers) || !Array.isArray(review.fixes) || !['continue', 'refine-spec', 'refine-code', 'request-input', 'stop'].includes(review.action)) {
    throw new Error(`Invalid critic response: ${result.text.slice(0, 1200)}`);
  }
  return { ...result, review, prompt };
}
