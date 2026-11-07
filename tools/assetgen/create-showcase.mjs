import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import * as THREE from 'three';
import { verifierSourceHash } from './bundle.mjs';
import { readBible, readSpec, readVisionProbe, root, runDirectory } from './config.mjs';
import { diagnosticEligibility } from './diagnostic-preview.mjs';
import { inspectRecipe } from './geometry.mjs';
import { validateRecipe } from './schema.mjs';
import { renderShowcasePage } from './showcase-page.mjs';
import { visualCheckSummary } from './showcase-checks.mjs';
import { assessReviewReadiness } from './review-readiness.mjs';
import { P0_SHOWCASE_POSITIONS } from './p0-showcase-positions.js';
import { createVisualRunner } from './visual.mjs';

const ids = ['round-oak-a', 'round-oak-b', 'small-bush', 'rock-a', 'rock-b', 'rock-c', 'barrel', 'crate', 'hay-bale'];
const finalOutput = resolve(process.env.ASSETGEN_SHOWCASE_DIR || join(homedir(), 'OpenBot/Shared/lookdev-assets/showcase'));
const outside = relative(root, finalOutput);
if (!(outside === '..' || outside.startsWith(`..${sep}`)) || isAbsolute(outside)) throw new Error('Showcase output must be outside the repository');
const exists = async (path) => { try { await access(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const readJson = async (path) => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const readText = async (path) => { try { return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
if (await exists(finalOutput)) throw new Error(`Refusing to overwrite existing showcase directory: ${finalOutput}`);
await mkdir(dirname(finalOutput), { recursive: true });
const output = await mkdtemp(join(dirname(finalOutput), '.asset-showcase-build-'));

const bible = await readBible();
const sourceHash = await verifierSourceHash();
const probe = await readVisionProbe();
const entries = [];
for (const id of ids) {
  const { spec, path: specPath } = await readSpec(id);
  const directory = join(runDirectory, id);
  const [final, recipeBytes, specBytes, verification] = await Promise.all([
    readJson(join(directory, 'final.json')), readText(join(directory, 'candidate.json')), readFile(specPath, 'utf8'), readJson(join(directory, 'verify/report.json')),
  ]);
  const recipe = recipeBytes === null ? null : JSON.parse(recipeBytes);
  const stage = final?.best && Number.isInteger(final.best.round) && final.best.round >= 1 && final.best.round <= bible.rules.loop.maxRounds &&
    bible.rules.loop.stages.includes(final.best.stage) ? join(directory, `round-${final.best.round}`, `stage-${final.best.stage}`) : null;
  const stageReport = stage ? await readJson(join(stage, 'report.json')) : null;
  const receipts = stage ? { generator: await readText(join(stage, 'generator.jsonl')), critic: await readText(join(stage, 'critic.jsonl')) } : null;
  entries.push({ id, spec, specBytes, directory, final, recipe, recipeBytes, verification, stage, stageReport, receipts });
}

const runner = await createVisualRunner();
try {
  const { buildRecipe } = await runner.server.ssrLoadModule('/src/assets/buildRecipe.ts');
  const { ASSET_PALETTE, ACCENT_TOKENS } = await runner.server.ssrLoadModule('/src/assets/palette.ts');
  const referenceRecipes = Object.fromEntries(entries.filter((entry) => entry.recipe).map((entry) => [entry.id, entry.recipe]));
  const environment = { buildRecipe, palette: ASSET_PALETTE, accentTokens: ACCENT_TOKENS, referenceRecipes };
  const records = [], overviewItems = [];
  for (const entry of entries) {
    const { id, spec, recipe, verification, stageReport, final } = entry;
    let inspected = null, group = null, safe = false, previewNotes = [];
    if (recipe) {
      inspected = inspectRecipe(recipe, spec, bible.rules, environment);
      const schemaFailures = validateRecipe(recipe, spec, bible.rules, ASSET_PALETTE, ACCENT_TOKENS);
      ({ safe, notes: previewNotes } = diagnosticEligibility(recipe, schemaFailures, bible.rules));
      if (safe) try { group = buildRecipe(recipe); } catch { safe = false; }
    }
    if (safe) {
      const position = P0_SHOWCASE_POSITIONS[id];
      if (!position) throw new Error(`Missing P0 showcase position for ${id}`);
      overviewItems.push({ recipe, x: position[0], z: position[1] });
    }
    const verifiedDir = join(entry.directory, 'verify');
    const stageRender = entry.stage ? join(entry.stage, 'render') : null;
    let packDir = await exists(join(verifiedDir, 'sheet.png')) ? verifiedDir
      : stageRender && await exists(join(stageRender, 'sheet.png')) ? stageRender : null;
    let kind = packDir ? 'verifier render pack' : null, diagnostic = null;
    if (!packDir && safe) {
      await mkdir(verifiedDir, { recursive: true });
      const inputHash = createHash('sha256').update(JSON.stringify({ spec, recipe, sourceHash })).digest('hex');
      for (const name of await readdir(verifiedDir)) if (name === 'diagnostic' || name.startsWith('diagnostic-')) {
        try {
          const previous = await readJson(join(verifiedDir, name, 'diagnostic.json'));
          if (previous?.inputHash === inputHash && previous.status === 'diagnostic-only') { packDir = join(verifiedDir, name); diagnostic = previous; break; }
        } catch { /* Incomplete or unrelated evidence is preserved, not reused. */ }
      }
      if (!diagnostic) {
        const standard = join(verifiedDir, 'diagnostic');
        packDir = await exists(standard) ? await mkdtemp(join(verifiedDir, 'diagnostic-')) : standard;
        const visual = await runner.capture(spec, bible.rules, packDir, recipe, { jitter: true });
        diagnostic = { id, status: 'diagnostic-only', inputHash, previewNotes, note: 'A render for human review, not a hard-gate pass or an independent critique.',
          hard: verification?.hard ?? { failures: inspected.failures, metrics: inspected.metrics }, visual };
        await writeFile(join(packDir, 'diagnostic.json'), `${JSON.stringify(diagnostic, null, 2)}\n`, { flag: 'wx' });
      }
      kind = 'diagnostic';
    }
    let measured = null;
    if (group) {
      group.updateMatrixWorld(true);
      let triangles = 0;
      const colors = new Set();
      group.traverse((part) => { if (part.isMesh) {
        triangles += Math.floor((part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3);
        for (const material of Array.isArray(part.material) ? part.material : [part.material]) if (material?.color) colors.add(material.color.getHex());
      } });
      const box = new THREE.Box3().setFromObject(group, true);
      const size = box.getSize(new THREE.Vector3());
      measured = { triangles, colorCount: colors.size, bounds: { min: box.min.toArray(), max: box.max.toArray(), width: size.x, height: size.y, depth: size.z } };
    }
    const hard = verification?.hard ?? (inspected ? { failures: inspected.failures, metrics: inspected.metrics } : null);
    const checks = Object.fromEntries(Array.from({ length: 10 }, (_, i) => {
      const code = `H${i + 1}`, check = hard?.metrics?.checks?.[code];
      return [code, check === true || check === false ? check : hard?.failures?.some((failure) => failure.code === code) ? false : null];
    }));
    const visual = typeof verification?.visual === 'object' ? verification.visual : stageReport?.visual;
    const reviewReadiness = assessReviewReadiness({ spec, specBytes: entry.specBytes, recipeBytes: entry.recipeBytes, bible, sourceHash,
      final, stage: stageReport, verification, receipts: entry.receipts, probe, environment });
    const unique = new Map();
    for (const failure of [...(hard?.failures || []), ...(visual?.failures || []), ...(stageReport?.blockers || []), ...reviewReadiness.reasons]) unique.set(`${failure.code}\0${failure.message}`, failure);
    if (!final) unique.set('NO_FINAL', { code: 'NO_FINAL', message: 'The generator did not complete a final report.' });
    if (!recipe) unique.set('NO_CANDIDATE', { code: 'NO_CANDIDATE', message: final?.stopReason || 'No generated candidate is available.' });
    const target = join(output, 'images', id);
    const copied = [];
    if (packDir) {
      await mkdir(target, { recursive: true });
      const filenames = ['sheet.png', 'native-debug.png', 'composite-daytime.png', 'composite-night.png',
        'silhouette-front-grass.png', 'silhouette-side-grass.png', 'silhouette-front-path.png', 'silhouette-side-path.png',
        ...['daytime', 'sunset', 'night'].flatMap((phase) => Array.from({ length: 8 }, (_, yaw) => `${phase}-grass-${String(yaw * 45).padStart(3, '0')}.png`))];
      for (const filename of filenames) if (await exists(join(packDir, filename))) {
        await copyFile(join(packDir, filename), join(target, filename), constants.COPYFILE_EXCL);
        copied.push(filename);
      }
    }
    let reportHref = null, diagnosticHref = null;
    if (verification) {
      await mkdir(target, { recursive: true });
      await copyFile(join(verifiedDir, 'report.json'), join(target, 'report.json'), constants.COPYFILE_EXCL);
      reportHref = `images/${id}/report.json`;
    }
    if (diagnostic) {
      await copyFile(join(packDir, 'diagnostic.json'), join(target, 'diagnostic.json'), constants.COPYFILE_EXCL);
      diagnosticHref = `images/${id}/diagnostic.json`;
    }
    records.push({ id, status: final?.status ?? (recipe ? 'incomplete run' : 'not generated'), brief: spec.brief, rounds: final?.roundsUsed ?? null,
      triangles: hard?.metrics?.triangles ?? measured?.triangles ?? null, bounds: hard?.metrics?.bounds ?? measured?.bounds ?? null,
      metricSource: hard?.metrics?.triangles != null ? 'verifier' : measured ? 'diagnostic geometry only' : 'not measured',
      colorCount: hard?.metrics?.colorCount ?? measured?.colorCount ?? null,
      colors: Array.isArray(recipe?.parts) ? [...new Set(recipe.parts.filter((part) => typeof part?.mat === 'string')
        .map((part) => recipe.slots?.[part.mat] ?? part.mat))].sort() : [], checks,
      visualChecks: visualCheckSummary(visual), reviewReadiness,
      failures: [...unique.values()], warnings: verification?.warnings ?? stageReport?.warnings ?? [],
      unmeasured: visual?.metrics?.unmeasured ?? ['Visual verification not run'],
      critiqueStatus: stageReport?.critiqueStatus ?? final?.visualCritiqueStatus ?? 'visual critique not run',
      criticScores: stageReport?.critique?.imageReviewed ? stageReport.critique.scores : null,
      pack: kind ? { kind, files: copied, notes: kind === 'diagnostic' ? previewNotes : [] } : null, reportHref, diagnosticHref });
  }

  const included = entries.filter((entry) => overviewItems.some((item) => item.recipe.id === entry.id)).map((entry) => entry.id);
  const overview = { available: false, included, missing: ids.filter((id) => !included.includes(id)) };
  if (overviewItems.length) {
    const target = join(output, 'images/island');
    await mkdir(target, { recursive: true });
    const page = await runner.browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.addInitScript((items) => { window.__assetShowcaseItems = items; }, overviewItems);
      const url = `http://127.0.0.1:${runner.server.httpServer.address().port}/tools/assetgen/showcase-render.html`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!window.__assetShowcase, null, { timeout: 45000 });
      const state = await page.evaluate(() => ({ count: window.__assetShowcase.count, pixel: window.__assetShowcase.pixel() }));
      if (state.count !== overviewItems.length || !state.pixel.enabled || state.pixel.canvasWidth !== 320 || state.pixel.canvasHeight !== 180 || errors.length) {
        throw new Error(`Island render invalid: ${JSON.stringify({ state, errors })}`);
      }
      for (const phase of ['daytime', 'sunset', 'night']) for (let yaw = 0; yaw < 360; yaw += 45) {
        await page.evaluate(({ yaw, phase }) => window.__assetShowcase.setView(yaw, phase), { yaw, phase });
        const path = join(target, `${phase}-${String(yaw).padStart(3, '0')}.png`);
        if (await exists(path)) throw new Error(`Refusing to overwrite ${path}`);
        await page.screenshot({ path });
      }
      overview.available = true;
    } finally { await page.close(); }
  }
  const manifest = { generatedAt: new Date().toISOString(), purpose: 'P0-only human review; no signoff or runtime registry', overview, assets: records };
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(join(output, 'assets.html'), renderShowcasePage(manifest), { flag: 'wx' });
  if (await exists(finalOutput)) throw new Error(`Refusing to overwrite existing showcase directory: ${finalOutput}; staged at ${output}`);
  await rename(output, finalOutput);
  console.log(`P0 review showcase: ${join(finalOutput, 'assets.html')} (${included.length}/${ids.length} island candidates)`);
} finally { await runner.close(); }
