import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { root } from './config.mjs';
import { checkKeyLightAgreement } from './geometry.mjs';
import { A9_PHASES, a9FloorFailures, currentA9Inputs, isTreeClass, measureA9Calibration, readA9Calibration,
  resolveA9Calibration, writeA9Calibration } from './a9-calibration.mjs';

const digest = (data) => createHash('sha256').update(data).digest('hex');
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function classifyS2(sample, limits) {
  const failures = [], warnings = [];
  const tooSmall = sample.pixels < limits.minimumSilhouettePixels;
  const lowContrast = sample.meanContrastRatio < limits.minimumContrastRatio && sample.meanDeltaE < limits.minimumDeltaE;
  const night = sample.phase === 'night' || sample.phase === 'night-rain';
  const label = `${sample.phase}/${sample.yaw}°/${sample.surface}`;
  const detail = `${sample.pixels} pixels, contrast ${sample.meanContrastRatio.toFixed(2)}, CIE76 ΔE ${sample.meanDeltaE.toFixed(1)}`;
  if (!night && (tooSmall || lowContrast)) failures.push({ code: 'S2', message: `${label}: ${detail}` });
  if (night && tooSmall) {
    const result = { code: 'S2', message: `${label}: ${sample.pixels} pixels below the ${limits.minimumSilhouettePixels}-pixel floor` };
    if (sample.surface === 'grass') failures.push(result);
    else warnings.push({ ...result, message: `${label}: advisory night silhouette: ${sample.pixels} pixels below the ${limits.minimumSilhouettePixels}-pixel floor` });
  }
  if (night && lowContrast) warnings.push({ code: 'S2', message: `${label}: advisory night contrast: ${detail}` });
  return { failures, warnings };
}

export async function createVisualRunner() {
  const host = process.env.ASSETGEN_HOST || '127.0.0.1';
  const port = Number(process.env.ASSETGEN_PORT || 0);
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host, port, strictPort: Boolean(port), hmr: false } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  } catch (error) { await server.close(); throw error; }
  const url = `http://${host}:${server.httpServer.address().port}`;
  let calibrationKey = null, calibrationCache = null;

  async function measureSignedA9(inputs, rules, name, directory) {
    const target = inputs.signed.expected[name];
    const spec = { id: `signed-${name}`, category: target.category,
      size: { width: target.size[0], height: target.size[1], depth: target.size[2] }, identityFeatures: [] };
    const visual = await capture(spec, rules, join(directory, name), null, { signedFixture: name, calibrationPass: true });
    if (visual.failures.some((failure) => ['BROWSER', 'PIXEL_RENDER'].includes(failure.code))) {
      throw new Error(`A9_CALIBRATION_UNMEASURED: ${name}: ${JSON.stringify(visual.failures)}`);
    }
    return Object.fromEntries(A9_PHASES.map((phase) => {
      const measurement = visual.metrics.phaseLighting?.[phase];
      if (measurement?.status !== 'pass' || !Number.isFinite(measurement.shadeLitRatio)) {
        throw new Error(`A9_CALIBRATION_UNMEASURED: ${name}/${phase}`);
      }
      return [phase, measurement.shadeLitRatio];
    }));
  }

  const inputsKey = (inputs) => JSON.stringify({ sourceHash: inputs.sourceHash, signedHashes: inputs.signedHashes });
  async function calibration(rules) {
    const stored = await readA9Calibration();
    const inputs = await currentA9Inputs(server, rules, browser.version());
    const key = `${JSON.stringify(stored)}\0${inputsKey(inputs)}`;
    if (key !== calibrationKey) {
      calibrationKey = key;
      calibrationCache = (async () => {
        let directory;
        const resolved = await resolveA9Calibration({ stored, inputs, measure: async (name) => {
          directory ??= await mkdtemp(join(tmpdir(), 'assetgen-a9-calibration-'));
          return measureSignedA9(inputs, rules, name, directory);
        } });
        if (inputsKey(await currentA9Inputs(server, rules, browser.version())) !== inputsKey(inputs)) {
          throw new Error('A9_CALIBRATION_CHANGED: signed references or measurement source changed during calibration');
        }
        return directory ? { ...resolved, evidence: directory } : resolved;
      })().catch((error) => { calibrationKey = null; calibrationCache = null; throw error; });
    }
    return calibrationCache;
  }

  async function recalibrate(rules) {
    const inputs = await currentA9Inputs(server, rules, browser.version());
    const directory = await mkdtemp(join(tmpdir(), 'assetgen-a9-calibration-'));
    const table = await measureA9Calibration(inputs, (name) => measureSignedA9(inputs, rules, name, directory));
    if (inputsKey(await currentA9Inputs(server, rules, browser.version())) !== inputsKey(inputs)) {
      throw new Error('A9_CALIBRATION_CHANGED: signed references or measurement source changed during calibration');
    }
    await writeA9Calibration(table);
    calibrationKey = null; calibrationCache = null;
    return { source: 'written', ...table, evidence: directory };
  }

  async function contactSheet(spec, frames, composites, destination) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      const panels = frames.map((frame) => `<div class="frame"><img src="data:image/png;base64,${frame.data.toString('base64')}"><div class="tag">${escape(frame.phase)} · ${frame.yaw}°</div></div>`).join('');
      const context = composites.map((item) => `<div class="context"><img src="data:image/png;base64,${item.data.toString('base64')}"><div class="tag">SIGNED FARM · ${escape(item.phase)}</div></div>`).join('');
      await page.setContent(`<!doctype html><style>
        *{box-sizing:border-box}body{margin:0;background:#1c211c;color:#f5e7c9;font:600 14px system-ui,sans-serif}
        header{height:44px;padding:10px 16px;font-size:19px}.grid{display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(3,120px);height:360px}
        .frame{position:relative;overflow:hidden;background:#34452f;border:1px solid #4b4536}.frame img{position:absolute;width:600%;height:450%;left:-250%;top:${-210 + (spec.size.height / 2 - 0.7) * Math.sqrt(2 / 3) * 9 * 3}px;image-rendering:pixelated}
        .tag{position:absolute;top:4px;left:4px;background:#211d18dd;padding:3px 5px;font-size:11px}.footer{display:flex;height:264px;gap:10px;padding:10px}
        .context{position:relative;width:390px;height:220px;overflow:hidden}.context img{width:100%;height:100%;image-rendering:pixelated}
        .note{flex:1;line-height:1.5;padding:8px;color:#eadcbb}.small{color:#d1ba91;font-size:12px}
      </style><header>${escape(spec.id)} · 8 fixed yaws × 3 phases · 3× nearest-neighbour crops</header><div class="grid">${panels}</div><div class="footer">${context}<div class="note">Identity: ${escape(spec.identityFeatures.map((f) => f.id).join(', '))}<br>Context: actual game scale, cottage/coops/tree/fence/character.<br><br><span class="small">Merged EBR-80 lighting. This sheet is preliminary, not visual approval.</span></div></div>`);
      await page.screenshot({ path: destination });
    } finally { await page.close(); }
  }

  async function capture(spec, rules, directory, fixture, options = {}) {
    const activeCalibration = options.calibrationPass ? null : await calibration(rules);
    await mkdir(directory, { recursive: true });
    const page = await browser.newPage({ viewport: { width: rules.render.width, height: rules.render.height }, deviceScaleFactor: 1 });
    if (fixture) await page.addInitScript((recipe) => { window.__assetForgeFixture = recipe; }, fixture);
    if (options.wrongKeyFixture) await page.addInitScript(() => { window.__assetForgeWrongKey = true; });
    if (options.signedFixture) await page.addInitScript((name) => { window.__assetForgeSigned = name; }, options.signedFixture);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
    try {
      let attempts = 0;
      while (true) {
        attempts++;
        errors.length = 0;
        try {
          await page.goto(`${url}/tools/assetgen/render.html?id=${encodeURIComponent(spec.id)}`, { waitUntil: 'networkidle' });
          if (errors.some((error) => error.includes('ERR_NETWORK_CHANGED'))) throw new Error('ERR_NETWORK_CHANGED during module loading');
          await page.waitForFunction(() => !!window.__assetForge, null, { timeout: 45000 });
          break;
        } catch (error) {
          if (attempts >= 3 || ![String(error), ...errors].some((message) => message.includes('ERR_NETWORK_CHANGED'))) throw error;
        }
      }
      const frameIndex = [], contactFrames = [], samples = [], featureVisibility = {}, partVisibility = {},
        featureByPhase = {}, partByPhase = {}, lightSamples = [], lightByPhase = {}, keyByPhase = {};
      for (const feature of spec.identityFeatures) featureVisibility[feature.id] = [];
      for (const phase of [...rules.render.phases, ...(rules.render.extraPhases || [])]) for (const yaw of rules.render.yaws) for (const surface of rules.render.surfaces) {
        const capture = await page.evaluate(({ yaw, phase, surface, delta, ids }) => window.__assetForge.capture(yaw, phase, surface, delta, ids),
          { yaw, phase, surface, delta: rules.render.pixelDeltaRGB, ids: spec.identityFeatures.map((feature) => feature.id) });
        const data = Buffer.from(capture.image, 'base64');
        const filename = `${phase}-${surface}-${String(yaw).padStart(3, '0')}.png`;
        await writeFile(join(directory, filename), data);
        frameIndex.push({ file: filename, sha256: digest(data), yaw, phase, surface });
        if (surface === 'grass' && rules.render.phases.includes(phase)) contactFrames.push({ data, yaw, phase });
        const { lightingSamples, ...measured } = capture.measured;
        if (surface === 'grass') {
          lightByPhase[phase] ??= [];
          lightByPhase[phase].push(...lightingSamples);
          keyByPhase[phase] = capture.keyDirection;
          featureByPhase[phase] ??= {};
          partByPhase[phase] ??= {};
          for (const feature of spec.identityFeatures) featureByPhase[phase][feature.id] ??= [];
          for (const [feature, pixels] of Object.entries(capture.identities)) featureByPhase[phase][feature].push({ yaw, pixels });
          for (const [name, part] of Object.entries(capture.identityParts)) {
            partByPhase[phase][name] ??= { feature: part.feature, views: [] };
            partByPhase[phase][name].views.push({ yaw, pixels: part.pixels });
          }
        }
        if (phase === 'daytime' && surface === 'grass') {
          lightSamples.push(...lightingSamples);
          for (const [feature, pixels] of Object.entries(capture.identities)) featureVisibility[feature].push({ yaw, pixels });
          for (const [name, part] of Object.entries(capture.identityParts)) {
            partVisibility[name] ??= { feature: part.feature, views: [] };
            partVisibility[name].views.push({ yaw, pixels: part.pixels });
          }
        }
        samples.push({ yaw, phase, surface, ...measured });
      }
      for (const yaw of [0, 45, 90]) for (const surface of ['grass', 'path']) {
        const encoded = await page.evaluate(({ yaw, surface }) => window.__assetForge.silhouette(yaw, surface), { yaw, surface });
        const data = Buffer.from(encoded, 'base64');
        const filename = `silhouette-${surface}-${String(yaw).padStart(3, '0')}.png`;
        await writeFile(join(directory, filename), data);
        frameIndex.push({ file: filename, sha256: digest(data), yaw, phase: 'daytime', surface, kind: 'black-silhouette-320x180' });
      }
      for (const [name, yaw] of [['front', 0], ['side', 90]]) for (const surface of ['grass', 'path']) {
        const encoded = await page.evaluate(({ yaw, surface }) => window.__assetForge.silhouette(yaw, surface, true), { yaw, surface });
        const data = Buffer.from(encoded, 'base64');
        const filename = `silhouette-${name}-${surface}.png`;
        await writeFile(join(directory, filename), data);
        frameIndex.push({ file: filename, sha256: digest(data), yaw, phase: 'daytime', surface, kind: `orthographic-${name}-silhouette-320x180` });
      }
      const composites = [];
      const jitter = [];
      if (options.jitter) for (let yaw = 0; yaw < 360; yaw += 15) {
        const capture = await page.evaluate((angle) => window.__assetForge.jitter(angle), yaw);
        for (const [kind, encoded] of [['base', capture.beforeImage], ['offset', capture.afterImage]]) {
          const data = Buffer.from(encoded, 'base64');
          const filename = `jitter-${String(yaw).padStart(3, '0')}-${kind}.png`;
          await writeFile(join(directory, filename), data);
          frameIndex.push({ file: filename, sha256: digest(data), yaw, phase: 'daytime', surface: 'grass', kind: `jitter-${kind}` });
        }
        const { beforeImage: _before, afterImage: _after, ...metrics } = capture;
        jitter.push(metrics);
      }
      for (const phase of ['daytime', 'night']) {
        await page.evaluate((phase) => window.__assetForge.setView(45, phase, 'grass', true), phase);
        const data = await page.screenshot({ type: 'png' });
        const filename = `composite-${phase}.png`;
        await writeFile(join(directory, filename), data);
        frameIndex.push({ file: filename, sha256: digest(data), phase, surface: 'signed-farm' });
        composites.push({ phase, data });
      }
      await page.evaluate(() => { window.__assetForge.setView(45, 'daytime', 'grass'); window.__assetForge.native(true); });
      const native = await page.screenshot({ type: 'png' });
      await writeFile(join(directory, 'native-debug.png'), native);
      frameIndex.push({ file: 'native-debug.png', sha256: digest(native), phase: 'daytime', surface: 'grass' });
      await page.evaluate(() => { window.__assetForge.native(false); window.__assetForge.setView(45, 'daytime', 'grass'); });
      const state = await page.evaluate(() => window.__assetForge.state());
      await contactSheet(spec, contactFrames, composites, join(directory, 'sheet.png'));
      frameIndex.push({ file: 'sheet.png', sha256: digest(await readFile(join(directory, 'sheet.png'))), surface: 'contact-sheet' });
      const failures = [], warnings = [];
      if (options.jitter) {
        const checked = jitter.reduce((sum, item) => sum + item.checkedPixels, 0);
        const candidates = jitter.reduce((sum, item) => sum + item.flickerCandidates, 0);
        if (!checked || jitter.length !== 24) failures.push({ code: 'A7_UNMEASURED', message: '24-yaw interior jitter did not provide measurable pixels' });
        if (candidates) failures.push({ code: 'A7_FLICKER', message: `${candidates} unmatched interior pixels across 24 jittered yaws` });
      }
      if (!state.pixel.enabled || state.pixel.canvasWidth !== 320 || state.pixel.canvasHeight !== 180 || state.pixel.cssPixelSize !== 4) {
        failures.push({ code: 'PIXEL_RENDER', message: 'The real game pixel pass did not render at 320×180 / 4 CSS pixels' });
      }
      for (const sample of samples) {
        const s2 = classifyS2(sample, rules.render);
        failures.push(...s2.failures);
        warnings.push(...s2.warnings);
        if ((sample.phase === 'night' || sample.phase === 'night-rain') && sample.blownHighlights > 0) {
          failures.push({ code: 'S5_HIGHLIGHT', message: `${sample.phase}/${sample.yaw}°/${sample.surface}: ${sample.blownHighlights} blown highlights` });
        }
      }
      for (const [feature, views] of Object.entries(featureVisibility)) {
        if (!views.some((view) => view.pixels >= rules.render.identityMinimumPixels)) {
          failures.push({ code: 'IDENTITY_VISIBLE', message: `${feature} contributes fewer than ${rules.render.identityMinimumPixels} pixels in every fixed daytime view` });
        }
      }
      for (const [name, part] of Object.entries(partVisibility)) {
        if (!part.views.some((view) => view.pixels >= rules.render.identityMinimumPixels)) {
          failures.push({ code: 'IDENTITY_VISIBLE', message: `${part.feature}/${name} contributes fewer than ${rules.render.identityMinimumPixels} pixels in every fixed daytime view` });
        }
      }
      for (const [phase, features] of Object.entries(featureByPhase)) for (const [feature, views] of Object.entries(features)) {
        if (!views.some((view) => view.pixels >= rules.render.identityMinimumPixels)) {
          failures.push({ code: 'IDENTITY_VISIBLE', message: `${phase}: ${feature} contributes fewer than ${rules.render.identityMinimumPixels} pixels in every view` });
        }
      }
      for (const [phase, parts] of Object.entries(partByPhase)) for (const [name, part] of Object.entries(parts)) {
        if (!part.views.some((view) => view.pixels >= rules.render.identityMinimumPixels)) {
          failures.push({ code: 'IDENTITY_VISIBLE', message: `${phase}: ${part.feature}/${name} contributes fewer than ${rules.render.identityMinimumPixels} pixels in every view` });
        }
      }
      const light = checkKeyLightAgreement(lightSamples, state.keyDirection);
      if (light.status === 'fail') failures.push({ code: 'S4', message: light.message });
      const phaseLighting = Object.fromEntries(Object.entries(lightByPhase).map(([phase, values]) => [phase,
        { ...checkKeyLightAgreement(values, keyByPhase[phase]), sampleCount: values.length }]));
      for (const [phase, measurement] of Object.entries(phaseLighting)) {
        if (measurement.status === 'fail') failures.push({ code: 'S4', message: `${phase}: ${measurement.message}` });
      }
      if (activeCalibration) failures.push(...a9FloorFailures(spec, phaseLighting, activeCalibration));
      if (errors.length) failures.push({ code: 'BROWSER', message: errors.join('; ') });
      const result = { failures, warnings, metrics: { browser: browser.version(), loadAttempts: attempts, renderer: 'game createScene + createDayNightCycle + createComposer; SwiftShader, DPR 1',
        lightingStatus: 'merged EBR-80; preliminary', pixel: state.pixel, references: state.references, keyDirection: state.keyDirection,
        referenceScale: { actual: state.subjectHeight / state.references.character, target: spec.size.height / state.references.character },
        samples, identityVisibility: featureVisibility, identityPartVisibility: partVisibility, featureByPhase, partByPhase,
        jitter, keyLight: { ...light, sampleCount: lightSamples.length }, phaseLighting, a9Calibration: activeCalibration,
        a9FloorMode: isTreeClass(spec) ? 'tree-by-eye' : 'calibrated',
        unmeasured: ['S1 rendered palette-cluster distance after lighting', 'S3 three-step value structure / QA G2 phase-band method', 'S5 unlit-face glow beyond material and highlight checks', 'S7 style-reference distance',
          ...(options.jitter ? ['A7 excluded silhouette-edge pixels'] : ['A7 empirical jitter not run'])],
        frameIndex } };
      await writeFile(join(directory, 'frames.json'), `${JSON.stringify(frameIndex, null, 2)}\n`);
      return result;
    } catch (error) {
      return { failures: [{ code: 'BROWSER', message: [String(error), ...errors].join('; ') }], warnings: [], metrics: {} };
    } finally { await page.close(); }
  }

  async function reference(spec, destination, fixture) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      if (fixture) await page.addInitScript((recipe) => { window.__assetForgeFixture = recipe; }, fixture);
      await page.goto(`${url}/tools/assetgen/render.html?id=${encodeURIComponent(spec.id)}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!window.__assetForge, null, { timeout: 15000 });
      const image = await page.evaluate((zoom) => window.__assetForge.transparentReference(45, zoom), Math.min(10, 10 / Math.max(spec.size.height, spec.size.width * 0.8)));
      await writeFile(destination, Buffer.from(image, 'base64'));
    } finally { await page.close(); }
  }

  return { server, browser, capture, reference, calibration, recalibrate, close: async () => { await browser.close(); await server.close(); } };
}
