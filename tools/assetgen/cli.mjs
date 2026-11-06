import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { assetPath, evidenceDirectory, listSpecs, readBible, readSpec, root, runDirectory } from './config.mjs';
import { critique, generate, makePrompt } from './generator.mjs';
import { loadSceneConstants, sha256, verifyAsset } from './verify.mjs';
import { createBundleSheet, createVisualRunner } from './visual.mjs';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const exists = async (path) => { try { await readFile(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const summarize = (report) => `${report.id}: ${report.status} · ${report.metrics.geometry?.triangles ?? '?'} tris · ${report.failures.map((failure) => failure.code).join(', ') || 'checks passed'}`;

async function saveRound(spec, round, result, extra = {}) {
  const directory = join(runDirectory, spec.id, `round-${round}`);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'report.json'), json(result.report)),
    writeFile(join(directory, 'source.ts'), result.source),
    writeFile(join(directory, 'sheet.png'), result.sheet),
    ...Object.entries(extra).map(([name, content]) => writeFile(join(directory, name), content)),
  ]);
  return directory;
}

async function newAsset(input, args) {
  if (!input) throw new Error('Usage: npm run asset:new -- <spec.json|id> [--work-order|--check|--force] [--rounds 1..4]');
  const { spec } = await readSpec(input);
  const bible = await readBible();
  const path = assetPath(spec);
  const run = join(runDirectory, spec.id);
  await mkdir(run, { recursive: true });
  const old = await exists(path) ? await readFile(path, 'utf8') : null;
  const workOrder = args.includes('--work-order');
  const check = args.includes('--check');
  if (old !== null && !args.includes('--force') && !check && !workOrder) {
    throw new Error(`${relative(root, path)} already exists; use --force to preserve/replace it, or --check for a work-order result`);
  }
  if (workOrder) {
    const prompt = await makePrompt(spec, bible, null);
    await writeFile(join(run, 'work-order.md'), `${prompt}\n\nSave the module to ${relative(root, path)}, then run: npm run asset:new -- ${spec.id} --check\n`);
    console.log(`Work order: ${relative(root, join(run, 'work-order.md'))}`);
    return;
  }
  if (check && old === null) throw new Error(`No candidate exists at ${relative(root, path)}`);
  const roundsFlag = args.indexOf('--rounds');
  const maxRounds = check ? 1 : roundsFlag === -1 ? 4 : Number(args[roundsFlag + 1]);
  if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 4) throw new Error('--rounds must be an integer from 1 to 4');
  const oldRounds = (await readdir(run)).map((name) => /^round-(\d+)$/.exec(name)).filter(Boolean).map((match) => Number(match[1]));
  const firstRound = oldRounds.length ? Math.max(...oldRounds) + 1 : 1;
  const runner = await createVisualRunner();
  let final = null;
  let previous = null;
  let previousSheet = null;
  try {
    const constants = await loadSceneConstants(runner.server);
    await mkdir(dirname(path), { recursive: true });
    for (let index = 0; index < maxRounds; index++) {
      const round = firstRound + index;
      const prompt = await makePrompt(spec, bible, previous);
      let generation = { source: old || '', transcript: '' };
      if (!check) {
        try {
          generation = await generate(prompt, previousSheet);
          await writeFile(path, generation.source);
        } catch (error) {
          const message = `OpenCode generation unavailable: ${String(error)}. A work order has been saved.`;
          await writeFile(join(run, 'work-order.md'), `${prompt}\n\nSave the module to ${relative(root, path)}, then run: npm run asset:new -- ${spec.id} --check\n`);
          const result = { source: generation.source, sheet: await runner.placeholder(spec, message), report: {
            id: spec.id, category: spec.category, status: 'REJECTED', failures: [{ code: 'GENERATOR', message }], metrics: {}, score: 0,
          } };
          await saveRound(spec, round, result, { 'prompt.txt': prompt });
          final = { ...result.report, roundsUsed: index + 1, lastRound: round };
          console.error(message);
          break;
        }
      }
      const result = await verifyAsset(spec, bible, runner, constants);
      const directory = await saveRound(spec, round, result, { 'prompt.txt': prompt, 'generation.jsonl': generation.transcript });
      let review;
      try {
        review = await critique(spec, result.report, join(directory, 'sheet.png'));
        await writeFile(join(directory, 'critique.jsonl'), review.transcript);
        delete review.transcript;
        if (!review.accept) result.report.failures.push({ code: 'CRITIQUE', message: review.concerns.join('; ') || 'AI critique requested a revision' });
      } catch (error) {
        review = { imageReviewed: false, attachmentUsed: false, accept: false, score: 0, concerns: [String(error)] };
        result.report.failures.push({ code: 'CRITIQUE_UNAVAILABLE', message: String(error) });
      }
      result.report.critique = review;
      result.report.score = Math.max(0, Math.round(review.score - Math.min(60, result.report.failures.length * 8)));
      result.report.status = result.report.failures.length ? 'REJECTED' : 'PASS';
      await writeFile(join(directory, 'report.json'), json(result.report));
      await mkdir(evidenceDirectory, { recursive: true });
      await copyFile(join(directory, 'sheet.png'), join(evidenceDirectory, `${spec.id}.png`));
      console.log(`round ${round}: ${summarize(result.report)} · score ${result.report.score} · image ${review.imageReviewed ? 'reviewed' : 'not reviewed'}`);
      final = { ...result.report, roundsUsed: index + 1, lastRound: round };
      if (result.report.status === 'PASS') break;
      previous = { failures: result.report.failures, metrics: result.report.metrics, critique: review };
      previousSheet = join(directory, 'sheet.png');
    }
    if (final?.status !== 'PASS' && !check) {
      if (old !== null) await writeFile(path, old);
      else if (await exists(path)) await unlink(path); // Only a candidate created by this invocation.
    }
    if (final) await writeFile(join(run, 'final.json'), json(final));
    if (!final || final.status !== 'PASS') process.exitCode = 1;
  } finally {
    await runner.close();
  }
}

async function verifyCommand(input) {
  if (!input) throw new Error('Usage: npm run asset:verify -- <id|all>');
  const bible = await readBible();
  const candidates = input === 'all' ? await listSpecs() : [await readSpec(input)];
  const runner = await createVisualRunner();
  try {
    const constants = await loadSceneConstants(runner.server);
    let tested = 0;
    for (const { spec } of candidates) {
      if (input === 'all' && !await exists(assetPath(spec))) continue;
      const { report } = await verifyAsset(spec, bible, runner, constants);
      tested++;
      console.log(summarize(report));
      for (const failure of report.failures) console.error(`  ${failure.code}: ${failure.message}`);
      if (report.status !== 'PASS') process.exitCode = 1;
    }
    if (!tested) throw new Error('No asset source files found');
    console.log(`Verified ${tested} asset(s).`);
  } finally {
    await runner.close();
  }
}

async function bundle() {
  const bible = await readBible();
  const candidates = await listSpecs();
  const runner = await createVisualRunner();
  try {
    const constants = await loadSceneConstants(runner.server);
    const accepted = [];
    const gallery = [];
    for (const { spec } of candidates) {
      const finalPath = join(runDirectory, spec.id, 'final.json');
      let final;
      try { final = JSON.parse(await readFile(finalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!await exists(assetPath(spec))) {
        if (final) {
          const sheet = join(runDirectory, spec.id, `round-${final.lastRound}`, 'sheet.png');
          if (await exists(sheet)) gallery.push({ id: spec.id, status: 'REJECTED', sheet: await readFile(sheet) });
        }
        console.log(`${spec.id}: not shipped (no source)`);
        continue;
      }
      const result = await verifyAsset(spec, bible, runner, constants);
      const validProvenance = final?.status === 'PASS' && final.sourceHash === result.report.sourceHash &&
        final.specHash === result.report.specHash && final.bibleHash === result.report.bibleHash;
      if (!validProvenance) result.report.failures.push({ code: 'PROVENANCE', message: 'No passing loop report for this exact source, spec and bible' });
      result.report.status = result.report.failures.length ? 'REJECTED' : 'PASS';
      console.log(summarize(result.report));
      gallery.push({ id: spec.id, status: result.report.status, sheet: result.sheet });
      await mkdir(evidenceDirectory, { recursive: true });
      await writeFile(join(evidenceDirectory, `${spec.id}.png`), result.sheet);
      if (result.report.status === 'PASS') accepted.push({ spec, report: result.report, final });
      else process.exitCode = 1;
    }
    const imports = accepted.map(({ spec }, index) => `import * as asset${index} from './${spec.category}/${spec.id}';`).join('\n');
    const entries = accepted.map(({ spec }, index) => `  '${spec.id}': asset${index},`).join('\n');
    await writeFile(join(root, 'src/assets/index.ts'), `// Generated by npm run asset:bundle. Do not edit by hand.\nimport type { AssetModule } from './types';\n${imports}\n\nexport const assets: Readonly<Record<string, AssetModule>> = {\n${entries}\n};\n`);
    const manifest = { version: 1, assets: accepted.map(({ spec, report, final }) => ({ id: spec.id, category: spec.category,
      footprint: { width: spec.size.width, depth: spec.size.depth }, height: spec.size.height,
      sourceHash: report.sourceHash, triangles: report.metrics.geometry.triangles, score: final.score, rounds: final.roundsUsed })) };
    await writeFile(join(root, 'src/assets/manifest.json'), json(manifest));
    if (gallery.length) {
      await mkdir(evidenceDirectory, { recursive: true });
      await createBundleSheet(runner.browser, gallery, join(evidenceDirectory, 'bundle-sheet.png'));
    }
    console.log(`Bundled ${accepted.length} verified assets; gallery has ${gallery.length} tiles.`);
  } finally {
    await runner.close();
  }
}

const [command, input, ...args] = process.argv.slice(2);
try {
  if (command === 'new') await newAsset(input, args);
  else if (command === 'verify') await verifyCommand(input);
  else if (command === 'bundle') await bundle();
  else throw new Error(`Unknown assetgen command: ${basename(command || '')}`);
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
