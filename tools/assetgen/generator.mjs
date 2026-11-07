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

async function run(message, { cwd, attachment, timeout } = {}) {
  const args = ['run', '--format', 'json'];
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

export async function makePrompt(spec, bible, stage, current, previous, best) {
  const cheat = await readFile(join(root, 'tools/assetgen/recipe-cheatsheet.md'), 'utf8');
  const artBrief = await readFile(join(root, 'docs/asset-lookdev-brief.md'), 'utf8');
  const examples = [];
  for (const id of spec.referenceAssetIds.slice(0, 3)) {
    const path = references[id];
    if (!path) throw new Error(`Unknown signed reference ${id}`);
    examples.push(`SIGNED REFERENCE ${id} (${path}; shapes only, not permission to copy legacy colours):\n${await readFile(join(root, path), 'utf8')}`);
  }
  return `You are a game-art recipe generator. Do not call tools, edit files, use the network, or output TypeScript. Return ONE complete fenced JSON object. It is automatically built and independently checked.\n\nCURRENT STAGE: ${stage}. ${current ? 'Revise the current recipe only where this stage or the feedback requires; preserve successful geometry.' : 'Create the initial blockout, including a coarse but visible version of every identity feature.'} The six stages are blockout, form, material, detail, lighting and optimise. Every stage must already satisfy H1–H10, the 10% size tolerance, and render every identity feature; do not defer a missing feature to a later stage. No part, band or cleat thinner than 0.1. Round parts use 6–8 segments. Follow the exact spec dimensions. The standard material is already supplied by the builder. Never invent tokens or hexes.\n\nLOOK DEV BRIEF (PM recipe/4-round/no-animal rulings override format advice):\n${artBrief}\n\nSTYLE BIBLE:\n${bible.text}\n\nRECIPE CHEAT SHEET:\n${cheat}\n\nSPEC:\n${JSON.stringify(spec, null, 2)}\n\n${examples.join('\n\n')}\n\n${current ? `CURRENT RECIPE:\n${JSON.stringify(current, null, 2)}` : 'No current recipe.'}\n\n${previous ? `PREVIOUS VERIFICATION / CRITIQUE / CHANGE DIFF (fix the exact named failures):\n${JSON.stringify(previous, null, 2)}` : ''}\n\n${best ? `BEST CANDIDATE SO FAR:\n${JSON.stringify(best, null, 2)}` : ''}\n\nReturn exactly one complete JSON recipe in a fenced json block.`;
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
  const result = await run(prompt, { cwd, attachment: sheet, timeout: 180000 });
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
