import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { verifyBaselineArchive } from './baseline-archive.mjs';
import { buildSingleHtml } from './export-single-html.mjs';
import { compareParityFrames } from './parity-diff.mjs';

// EBR-78 compares the real offline export against the specifically assigned
// clean-main commit, not a mutable checkout or an instrumented export.
const baselineRef = 'a75e8db0bbd865df2000f030912bb6910258432c';
const evidenceRoot = '/home/michael/OpenBot/Shared/farm-evidence/EBR-78';
const baselineRoot = resolve('/home/michael/OpenBot/Shared/farm-evidence/_baseline', baselineRef);
const artifact = resolve('dist/chicken-farm.html');
const viewport = { width: 1280, height: 720 };
const scenarios = [
  { name: 'day', phase: 'daytime', weather: 'clear' },
  { name: 'sunset', phase: 'sunset', weather: 'clear' },
  { name: 'night', phase: 'night', weather: 'clear' },
  { name: 'rain', phase: 'daytime', weather: 'rain' },
];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const head = git('rev-parse', 'HEAD');
const shortHead = git('rev-parse', '--short=7', 'HEAD');
const parent = join(evidenceRoot, shortHead);
await mkdir(parent, { recursive: true });
const evidence = await mkdtemp(join(parent, 'export-gate-'));
const report = {
  version: 1, baselineSha: baselineRef, candidateSha: head, startedAt: new Date().toISOString(),
  viewport, deviceScaleFactor: 1, seed: 123, timeline: 'frame 0; W held for 8 x 100 ms; release; 17 x 100 ms',
  analyzer: 'tools/parity-diff.mjs exact RGBA, no mask', scenarios, results: {}, evidence, ok: false,
};
let server;
let browser;
try {
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '', 'Candidate worktree must be clean');
  assert.equal(git('rev-parse', `${baselineRef}^{commit}`), baselineRef, 'Assigned baseline is unavailable');
  assert.equal(git('diff', '--name-only', baselineRef, head, '--', 'src', 'index.html', 'package-lock.json'), '',
    'Game source, HTML entry, or locked dependencies differ from the assigned baseline');
  const oldPackage = JSON.parse(git('show', `${baselineRef}:package.json`));
  const currentPackage = JSON.parse(await readFile('package.json', 'utf8'));
  delete oldPackage.scripts;
  delete currentPackage.scripts;
  assert.deepEqual(currentPackage, oldPackage, 'Only package scripts may differ from the assigned baseline');
  await verifyBaselineArchive(baselineRoot, baselineRef);
  const html = await readFile(artifact);
  assert.equal(html.toString('utf8'), await buildSingleHtml(), 'Export artifact is not the current clean head build');
  report.artifact = { path: artifact, bytes: html.length, sha256: sha256(html) };

  server = await createServer({ root: baselineRoot, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 5251, strictPort: true, hmr: false } });
  await server.listen();
  report.baselineUrl = 'http://127.0.0.1:5251/';
  report.candidateUrl = pathToFileURL(artifact).href;
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
  report.browser = browser.version();
  for (const folder of ['baseline', 'export', 'diff']) await mkdir(join(evidence, folder));
  const comparePage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  let firstPose;
  try {
    for (const scenario of scenarios) {
      const query = `?phase=${scenario.phase}&weather=${scenario.weather}&seed=123`;
      const baseline = await capture(`${report.baselineUrl}${query}`, scenario, true);
      const candidate = await capture(`${report.candidateUrl}${query}`, scenario, false);
      await writeFile(join(evidence, 'baseline', `${scenario.name}.png`), baseline.png);
      await writeFile(join(evidence, 'export', `${scenario.name}.png`), candidate.png);
      const diff = await comparePage.evaluate(compareParityFrames, {
        reference: baseline.png.toString('base64'), candidate: candidate.png.toString('base64'),
      });
      assert.deepEqual([diff.width, diff.height], [viewport.width, viewport.height]);
      await writeFile(join(evidence, 'diff', `${scenario.name}.png`), Buffer.from(diff.png, 'base64'));
      const publicStateMatches = isDeepStrictEqual(baseline.publicState, candidate.publicState);
      firstPose ??= baseline.pose;
      const samePoseAcrossCases = isDeepStrictEqual(firstPose, baseline.pose);
      report.results[scenario.name] = {
        changedPixels: diff.changedPixels, outsideMaskPixels: diff.outsideMaskPixels,
        explanation: diff.changedPixels === 0 ? 'No differences' : 'Unexplained differences',
        publicStateMatches, samePoseAcrossCases, baselinePose: baseline.pose,
        baselineState: baseline.publicState, candidateState: candidate.publicState,
        baselineSha256: sha256(baseline.png), candidateSha256: sha256(candidate.png),
        fileRequests: candidate.requests,
      };
      console.log(`${scenario.name}: ${diff.changedPixels} changed pixels; state=${publicStateMatches ? 'same' : 'DIFF'}; pose=${samePoseAcrossCases ? 'same' : 'DIFF'}`);
    }
  } finally {
    await comparePage.close();
  }
  await verifyBaselineArchive(baselineRoot, baselineRef);
  assert.equal(git('rev-parse', 'HEAD'), head, 'Candidate HEAD moved during capture');
  assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), '', 'Worktree changed during capture');
  assert.ok(Object.values(report.results).every((item) => item.changedPixels === 0 && item.publicStateMatches && item.samePoseAcrossCases),
    'Gate G: unexplained pixels, environment differences, or pose mismatch');
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`Export Gate G FAILED: ${report.error}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'export-parity.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Export Gate G ${report.ok ? 'PASS' : 'FAIL'}: ${join(evidence, 'export-parity.json')}`);
}

async function capture(url, scenario, baseline) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  if (!baseline) await context.setOffline(true);
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  try {
    await page.addInitScript(() => {
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__exportGateStep = (time) => {
        const current = [...callbacks.values()];
        callbacks.clear();
        if (!current.length) throw new Error('No animation frame scheduled');
        for (const callback of current) callback(time);
      };
    });
    if (baseline) {
      // Inspect the dev-server pose without modifying the application or export.
      await page.route('**/src/main.ts*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\nwindow.__exportGatePose = { character, camera };\n` });
      });
    } else {
      await page.route('**/*', async (route) => {
        if (route.request().url() === url) await route.continue();
        else await route.abort('blockedbyclient');
      });
    }
    await page.goto(url, { waitUntil: 'load' });
    assert.ok(await page.evaluate(() => Boolean(window.getPixelRendering?.().canvasWidth)), 'Game did not initialize');
    if (baseline) assert.ok(await page.evaluate(() => Boolean(window.__exportGatePose)), 'Baseline pose probe did not load');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__exportGateStep(0));
    await page.keyboard.down('w');
    await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__exportGateStep(i * 100); });
    await page.keyboard.up('w');
    await page.evaluate(() => { for (let i = 9; i <= 25; i++) window.__exportGateStep(i * 100); });
    const state = await page.evaluate((inspect) => {
      const gl = document.querySelector('#scene').getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      const pose = inspect && window.__exportGatePose;
      return {
        publicState: { pixel: window.getPixelRendering(), weather: window.getWeather(), phase: window.getDayNightState(),
          label: document.querySelector('[data-phase]')?.textContent,
          webgl: gl?.getParameter(gl.VERSION), renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) },
        pose: pose ? { position: pose.character.position.toArray(), yaw: pose.character.rotation.y,
          camera: pose.camera.position.toArray(), cameraQuaternion: pose.camera.quaternion.toArray(), zoom: pose.camera.zoom } : null,
      };
    }, baseline);
    assert.match(state.publicState.webgl, /WebGL 2\.0/);
    assert.match(state.publicState.renderer, /SwiftShader/i);
    assert.equal(state.publicState.pixel.enabled, true);
    assert.deepEqual([state.publicState.pixel.canvasWidth, state.publicState.pixel.canvasHeight], [320, 180]);
    assert.equal(state.publicState.phase.phase, scenario.phase);
    assert.equal(state.publicState.weather.mode, scenario.weather);
    if (scenario.weather === 'rain') assert.equal(state.publicState.weather.rainAmount, 1);
    if (baseline) assert.ok(Math.hypot(state.pose.position[0], state.pose.position[2]) > 0.5, 'W did not move the character');
    else assert.deepEqual(requests, [url], 'Offline file requested another resource');
    assert.deepEqual(errors, []);
    const cdp = await context.newCDPSession(page);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await cdp.detach();
    return { ...state, requests: baseline ? undefined : requests, png: Buffer.from(screenshot.data, 'base64') };
  } finally {
    await context.close();
  }
}
