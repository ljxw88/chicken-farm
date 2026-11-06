import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { root } from './config.mjs';

const execute = promisify(execFile);
const referencePaths = {
  'signed-tree': 'src/scene/createFarmLayout.ts',
  'signed-cottage': 'src/scene/createCottage.ts',
  'signed-coop': 'src/scene/createRampCoop.ts',
  'signed-fence': 'src/placement/createPlacementVisual.ts',
  'signed-sign': 'src/scene/createFarmDecorations.ts',
};

export async function makePrompt(spec, bible, previous) {
  const references = [];
  for (const id of spec.referenceAssetIds.slice(0, 2)) {
    const path = referencePaths[id];
    if (!path) throw new Error(`Unknown reference asset id: ${id}`);
    references.push(`REFERENCE ${id} (${path}):\n\`\`\`typescript\n${await readFile(join(root, path), 'utf8')}\n\`\`\``);
  }
  return `You are the procedural 3D asset generator for this farm. Return ONLY one fenced typescript code block containing the COMPLETE module. Do not use tools, edit files, call the network, or return a patch. A program will write your block to src/assets/${spec.category}/${spec.id}.ts and independently compile, build, render and test it.

Implement an original, polished and recognisable asset, not a generic placeholder. Follow the style bible and the brief. Export const meta and export function build(): THREE.Group. Import * as THREE from 'three', FARM_PALETTE from '../../scene/farmPalette', BUILDING_PALETTE from '../../scene/farmBuildingMaterials' as needed, and optionally import type { AssetMeta } from '../types'. Do not import anything else. The exact metadata is: id '${spec.id}', category '${spec.category}', footprint { width: ${spec.size.width}, depth: ${spec.size.depth} }, height ${spec.size.height}, palette as an array of qualified keys actually used (e.g. 'farm.barnWood', 'building.timber'), triBudget an integer at most ${bible.rules.triBudgets[spec.category]}. Only use named palette values, no hex literals. Material is opaque THREE.MeshStandardMaterial with flatShading: true and roughness: 1, with no textures, emissive, polygon offset, transparency, lights or shadow maps. Return a new identity-transform THREE.Group. Center the total X/Z bounds on the origin; the bottom must touch y=0; front is +Z. Actual total bounds should closely match the declared dimensions. The verifier detects every pair of overlapping nearly coplanar triangles, including hidden faces and different meshes. Avoid coincident overlapping faces: intersect components by >0.004 units or separate them by >0.004 units. Do not use ConeGeometry or a cylinder with a zero-radius end (degenerate triangles); create a nondegenerate pointed mesh if needed. Use unit, outward-facing normals and no tiny or zero-area triangles. Keep details chunky and the silhouette distinctive at 320x180. No nondeterminism, HTML, animation, text, environment access, or external resources.

STYLE BIBLE:\n${bible.text}

SPEC:\n${JSON.stringify(spec, null, 2)}

${references.join('\n\n')}

${previous ? `PREVIOUS VERIFIER REPORT AND CRITIQUE: Fix all failures and preserve successes. The attached image, if present, is the previous contact sheet.\n${JSON.stringify(previous, null, 2)}` : 'This is the first generation round.'}

Output the TypeScript module only, in a single fenced typescript block.`;
}

async function opencode(message, attachment) {
  const binary = process.env.OPENCODE_BIN || join(homedir(), '.opencode/bin/opencode');
  const args = ['run', '--format', 'json'];
  if (attachment && process.env.ASSETGEN_IMAGES !== '0') args.push('--file', attachment);
  args.push(message);
  const { stdout, stderr } = await execute(binary, args, { cwd: root, timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
  const events = stdout.split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return { type: 'unparsed', text: line }; }
  });
  const errors = events.filter((event) => event.type === 'error');
  if (errors.length) throw new Error(`OpenCode error: ${JSON.stringify(errors)}${stderr ? ` ${stderr}` : ''}`);
  const text = events.filter((event) => event.type === 'text').map((event) => event.part?.text || event.text || '').join('\n');
  if (!text.trim()) throw new Error(`OpenCode returned no text${stderr ? `: ${stderr}` : ''}`);
  return { text, transcript: stdout, attachmentUsed: !!attachment && process.env.ASSETGEN_IMAGES !== '0' };
}

export async function generate(prompt, previousSheet) {
  let response;
  try {
    response = await opencode(prompt, previousSheet);
  } catch (error) {
    if (!previousSheet || process.env.ASSETGEN_IMAGES === '0') throw error;
    response = await opencode(`${prompt}\nThe image attachment was unavailable; use the numeric report.`, null);
    response.attachmentError = String(error);
  }
  const match = response.text.match(/```(?:typescript|ts)\s*\n([\s\S]*?)```/i) || response.text.match(/```\s*\n([\s\S]*?)```/);
  if (!match) throw new Error(`OpenCode did not return a fenced TypeScript module: ${response.text.slice(0, 1200)}`);
  return { ...response, source: `${match[1].trim()}\n` };
}

export async function critique(spec, report, sheetPath) {
  const prompt = `Review this procedural Three.js farm asset against the supplied contact sheet and numeric report. The first three panels are zoomed front/side/three-quarter views; the fourth is the actual game camera beside the signed cottage, coops, trees and fence. Be concrete: check whether the subject is recognisable as the brief, has a chunky clean silhouette, coherent palette and believable scale, and whether it survives the small 4-CSS-pixel game view. Automated hard failures cannot be overridden. Do not claim to see the image if you cannot. Return ONLY JSON with {"imageReviewed": boolean, "accept": boolean, "score": integer from 0 to 100, "concerns": [short concrete strings]}. Set accept false for concrete problems requiring revision; if the image is unavailable, assess only the numeric report and state that limitation. This is a preliminary AI critique, not Look Dev approval.\nSPEC: ${JSON.stringify(spec)}\nNUMERIC REPORT: ${JSON.stringify(report)}`;
  let response;
  try {
    response = await opencode(prompt, sheetPath);
  } catch (error) {
    response = await opencode(`${prompt}\nImage attachment unavailable; critique the numeric report only.`, null);
    response.attachmentError = String(error);
  }
  const cleaned = response.text.replace(/```(?:json)?/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`OpenCode critique did not return JSON: ${cleaned.slice(0, 1200)}`);
  const value = JSON.parse(match[0]);
  if (typeof value.accept !== 'boolean' || typeof value.imageReviewed !== 'boolean' || !Number.isFinite(value.score) ||
      value.score < 0 || value.score > 100 || !Array.isArray(value.concerns) || !value.concerns.every((item) => typeof item === 'string')) {
    throw new Error('OpenCode critique JSON has an invalid shape');
  }
  if (!response.attachmentUsed) value.imageReviewed = false;
  return { ...value, attachmentUsed: response.attachmentUsed, attachmentError: response.attachmentError || null, transcript: response.transcript };
}
