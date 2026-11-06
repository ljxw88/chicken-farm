import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { root } from './config.mjs';
import { checkKeyLightAgreement } from './geometry.mjs';

const digest = (data) => createHash('sha256').update(data).digest('hex');
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export async function createVisualRunner() {
  const server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  } catch (error) { await server.close(); throw error; }
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;

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
      </style><header>${escape(spec.id)} · 8 fixed yaws × 3 phases · 3× nearest-neighbour crops</header><div class="grid">${panels}</div><div class="footer">${context}<div class="note">Identity: ${escape(spec.identityFeatures.map((f) => f.id).join(', '))}<br>Context: actual game scale, cottage/coops/tree/fence/character.<br><br><span class="small">Existing pre-EBR-80 lighting. This sheet is preliminary, not visual approval.</span></div></div>`);
      await page.screenshot({ path: destination });
    } finally { await page.close(); }
  }

  async function capture(spec, rules, directory, fixture, options = {}) {
    await mkdir(directory, { recursive: true });
    const page = await browser.newPage({ viewport: { width: rules.render.width, height: rules.render.height }, deviceScaleFactor: 1 });
    if (fixture) await page.addInitScript((recipe) => { window.__assetForgeFixture = recipe; }, fixture);
    if (options.wrongKeyFixture) await page.addInitScript(() => { window.__assetForgeWrongKey = true; });
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
      const frameIndex = [], contactFrames = [], samples = [], featureVisibility = {}, partVisibility = {}, lightSamples = [];
      for (const feature of spec.identityFeatures) featureVisibility[feature.id] = [];
      for (const phase of rules.render.phases) for (const yaw of rules.render.yaws) for (const surface of rules.render.surfaces) {
        const capture = await page.evaluate(({ yaw, phase, surface, delta, ids }) => window.__assetForge.capture(yaw, phase, surface, delta, ids),
          { yaw, phase, surface, delta: rules.render.pixelDeltaRGB, ids: spec.identityFeatures.map((feature) => feature.id) });
        const data = Buffer.from(capture.image, 'base64');
        const filename = `${phase}-${surface}-${String(yaw).padStart(3, '0')}.png`;
        await writeFile(join(directory, filename), data);
        frameIndex.push({ file: filename, sha256: digest(data), yaw, phase, surface });
        if (surface === 'grass') contactFrames.push({ data, yaw, phase });
        const { lightingSamples, ...measured } = capture.measured;
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
      const composites = [];
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
      const failures = [];
      if (!state.pixel.enabled || state.pixel.canvasWidth !== 320 || state.pixel.canvasHeight !== 180 || state.pixel.cssPixelSize !== 4) {
        failures.push({ code: 'PIXEL_RENDER', message: 'The real game pixel pass did not render at 320×180 / 4 CSS pixels' });
      }
      const daytime = samples.filter((sample) => sample.phase === 'daytime');
      for (const sample of daytime) {
        if (sample.pixels < rules.render.minimumSilhouettePixels ||
            (sample.meanContrastRatio < rules.render.minimumContrastRatio && sample.meanHueDifference < rules.render.minimumHueDifferenceDegrees)) {
          failures.push({ code: 'S2', message: `${sample.yaw}°/${sample.surface}: ${sample.pixels} pixels, contrast ${sample.meanContrastRatio.toFixed(2)}, hue difference ${sample.meanHueDifference.toFixed(1)}°` });
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
      const light = checkKeyLightAgreement(lightSamples, state.keyDirection);
      if (light.status === 'fail') failures.push({ code: 'S4', message: light.message });
      if (errors.length) failures.push({ code: 'BROWSER', message: errors.join('; ') });
      const result = { failures, metrics: { browser: browser.version(), loadAttempts: attempts, renderer: 'game createScene + createDayNightCycle + createComposer; SwiftShader, DPR 1',
        lightingStatus: 'pre-EBR-80; preliminary', pixel: state.pixel, references: state.references, keyDirection: state.keyDirection,
        referenceScale: { actual: state.subjectHeight / state.references.character, target: spec.size.height / state.references.character },
        samples, identityVisibility: featureVisibility, identityPartVisibility: partVisibility, keyLight: { ...light, sampleCount: lightSamples.length },
        unmeasured: ['S1 rendered palette-cluster distance after lighting', 'S3 three-step value structure', 'S5 night glow/highlight analysis', 'S7 style-reference distance'],
        frameIndex } };
      await writeFile(join(directory, 'frames.json'), `${JSON.stringify(frameIndex, null, 2)}\n`);
      return result;
    } catch (error) {
      return { failures: [{ code: 'BROWSER', message: [String(error), ...errors].join('; ') }], metrics: {} };
    } finally { await page.close(); }
  }

  async function reference(spec, destination) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      await page.goto(`${url}/tools/assetgen/render.html?id=${encodeURIComponent(spec.id)}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => !!window.__assetForge, null, { timeout: 15000 });
      await page.evaluate((zoom) => window.__assetForge.reference(45, zoom), Math.min(8, 5 / Math.max(spec.size.height, spec.size.width * 0.8)));
      await page.screenshot({ path: destination, clip: { x: 320, y: 40, width: 640, height: 640 } });
    } finally { await page.close(); }
  }

  return { server, browser, capture, reference, close: async () => { await browser.close(); await server.close(); } };
}
