#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';
import { verifyBaselineArchive } from '../baseline-archive.mjs';
import { compareParityFrames } from '../parity-diff.mjs';
import { installHarnessTiming } from './timing.mjs';

const viewport = { width: 1280, height: 720 };
const seed = 123;
const epoch = Date.UTC(2026, 0, 1);
const scenarios = [
  { name: 'day', phase: 'daytime', weather: 'clear' },
  { name: 'sunset', phase: 'sunset', weather: 'clear' },
  { name: 'night', phase: 'night', weather: 'clear' },
  { name: 'rain', phase: 'daytime', weather: 'rain' },
];
const modes = [
  { name: 'off', qa: false, timing: false },
  { name: 'read', qa: true, timing: false },
  { name: 'timing', qa: false, timing: true },
  { name: 'both', qa: true, timing: true },
];
const pairs = [
  ['read-only', 'off', 'read'], ['timing-only', 'off', 'timing'], ['both', 'off', 'both'],
  ['read-with-timing', 'timing', 'both'], ['timing-with-read', 'read', 'both'],
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function parseArgs(args) {
  const result = { port: 5252, baseline: '880aa12', allowDirty: false };
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--allow-dirty') { result.allowDirty = true; continue; }
    if (name === '--help') { result.help = true; continue; }
    if (!['--output', '--port', '--baseline', '--only'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: node tools/selfplay/gate-g.mjs [--output /absolute/dir] [--port 5252] [--baseline SHA] [--only scenario] [--allow-dirty]');
    }
    const value = args[++i];
    if (name === '--output') {
      if (!isAbsolute(value)) throw new Error('--output must be absolute');
      result.output = resolve(value);
    } else if (name === '--port') {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('Invalid port');
      result.port = Number(value);
    } else if (name === '--baseline') result.baseline = value;
    else result.only = value;
  }
  if (result.only && !scenarios.some((item) => item.name === result.only)) throw new Error('Unknown scenario');
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/selfplay/gate-g.mjs [--output /absolute/dir] [--port 5252] [--baseline SHA] [--only scenario] [--allow-dirty]');
    return;
  }
  const root = await realpath(process.cwd());
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  const baseline = git('rev-parse', '--verify', `${options.baseline}^{commit}`);
  const currentMain = git('rev-parse', '--verify', 'origin/main^{commit}');
  execFileSync('git', ['merge-base', '--is-ancestor', baseline, currentMain], { cwd: root });
  execFileSync('git', ['merge-base', '--is-ancestor', currentMain, head], { cwd: root });
  const sourceStatus = git('status', '--porcelain=v1', '--untracked-files=all');
  if (sourceStatus && !options.allowDirty) throw new Error(`Gate G requires a clean worktree:\n${sourceStatus}`);
  let output = options.output ?? join('/home/michael/OpenBot/Shared/farm-evidence/EBR-77', head.slice(0, 7), 'gate-g');
  const missing = [];
  let parent = output;
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) throw new Error(`No existing ancestor for ${output}`);
    parent = next;
  }
  output = resolve(await realpath(parent), ...missing);
  const rel = relative(root, output);
  if (!rel || (!rel.startsWith('../') && rel !== '..' && !isAbsolute(rel))) throw new Error('Gate evidence must be outside the worktree');
  await mkdir(output, { recursive: true });
  if (existsSync(join(output, 'report.json'))) throw new Error(`Refusing to overwrite ${join(output, 'report.json')}`);
  const selected = options.only ? scenarios.filter((item) => item.name === options.only) : scenarios;
  const report = {
    version: 1, ok: false, head, baseline, currentMain, sourceStatus, startedAt: new Date().toISOString(),
    scope: options.only ? 'single-scenario development run' : 'complete', seed, viewport, deviceScaleFactor: 1,
    browser: null, build: {}, captures: {}, probes: {}, results: {}, crossBaseline: {}, currentMainComparison: {}, errors: [],
    timing: {
      common: 'Playwright virtual clock controls the same wall/performance time and native rAF in all captures',
      hookOn: 'self-play rAF scheduler batches callbacks and forwards browser timestamps; QA snapshots are read each frame when available',
      hookOff: 'no self-play rAF scheduler and no QA getter; the common Playwright clock remains in use',
      route: 'first frame, hold W for 800 ms, release, advance another 1000 ms, then render one more 16 ms frame',
      performanceOrigin: 'Chromium may give contexts different performance.now origins; elapsed time and wall time are compared instead',
      fps: 'not measured in this deterministic gate; the real-time self-play command measures it separately',
    },
    crossBaselineNote: `${baseline.slice(0, 7)}-versus-head differences are attributable to upstream only if the separately built current main matches head exactly.`,
  };
  let temp, browser, diffPage, server;
  const paths = {};

  async function command(label, executable, args, cwd) {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024 });
    const log = join(output, `${label}.log`);
    const text = `$ ${[executable, ...args].join(' ')}\ncwd=${cwd}\n${result.stdout ?? ''}${result.stderr ?? ''}`;
    await writeFile(log, text, { flag: 'wx' });
    report.build[label] = { command: [executable, ...args], cwd, exitCode: result.status, log,
      ...(result.error ? { error: result.error.message } : {}) };
    if (result.error || result.status !== 0) throw new Error(`${label} failed: ${result.error?.message ?? `exit ${result.status}`}`);
  }

  async function capture(source, scenario, mode) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      // Every mode gets the same external clock. Only timing-on installs the
      // self-play scheduler; timing-off uses Playwright's unwrapped rAF.
      await page.clock.install({ time: epoch });
      await page.clock.pauseAt(epoch + 1000);
      if (mode.timing) await page.addInitScript(installHarnessTiming);
      const query = new URLSearchParams({ seed: String(seed), phase: scenario.phase, weather: scenario.weather });
      if (mode.qa) query.set('qa', '1');
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?${query}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const startTime = await page.evaluate(() => ({ now: performance.now(), date: Date.now() }));
      const expectsGame = source === 'head' && mode.qa;
      assert.equal(await page.evaluate(() => Object.hasOwn(window, '__game')), expectsGame, 'Unexpected QA getter presence');
      assert.equal(await page.evaluate(() => Boolean(window.__selfplayTiming)), mode.timing, 'Unexpected timing hook presence');
      await page.clock.runFor(16);
      const before = expectsGame ? await page.evaluate(() => window.__game) : null;
      await page.keyboard.down('w');
      await page.clock.runFor(800);
      const walking = expectsGame ? await page.evaluate(() => window.__game) : null;
      await page.keyboard.up('w');
      await page.clock.runFor(1000);
      await page.clock.runFor(16);
      const state = await page.evaluate(() => {
        const gl = document.querySelector('#scene')?.getContext('webgl2');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        return {
          now: performance.now(), date: Date.now(), dayNight: window.getDayNightState(), weather: window.getWeather(),
          pixel: window.getPixelRendering(), phaseLabel: document.querySelector('[data-phase]')?.textContent,
          webgl: gl?.getParameter(gl.VERSION), renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
          game: window.__game ?? null, timing: window.__selfplayTiming ?? null,
        };
      });
      state.elapsedNow = state.now - startTime.now;
      state.elapsedDate = state.date - startTime.date;
      assert.match(state.webgl, /WebGL 2\.0/);
      assert.match(state.renderer, /SwiftShader/i);
      assert.equal(state.elapsedNow, 1832);
      assert.equal(state.elapsedDate, 1832);
      assert.equal(state.pixel.enabled, true);
      assert.equal(state.pixel.devicePixelRatio, 1);
      assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight], [320, 180]);
      assert.equal(state.dayNight.phase, scenario.phase);
      assert.equal(state.dayNight.following, false);
      assert.equal(state.weather.mode, scenario.weather);
      if (scenario.weather === 'rain') assert.equal(state.weather.rainAmount, 1, 'Rain must be fully transitioned');
      if (mode.timing) {
        assert.ok(state.timing.frames > 100, 'Timing hook did not drive the route');
        assert.equal(state.timing.reads, expectsGame ? state.timing.frames : 0);
      }
      if (expectsGame) {
        assert.deepEqual(before.player.position, [0, 2.4, 0]);
        assert.equal(walking.route.status, 'manual');
        assert.ok(Math.hypot(walking.player.position[0], walking.player.position[2]) > 0.5, 'W did not move the player');
        assert.equal(state.game.route.status, 'idle');
      }
      assert.deepEqual(errors, []);
      const cdp = await context.newCDPSession(page);
      const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await cdp.detach();
      const bytes = Buffer.from(image.data, 'base64');
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [viewport.width, viewport.height]);
      const path = join(output, `${source}-${scenario.name}-${mode.name}.png`);
      await writeFile(path, bytes, { flag: 'wx' });
      return { path, sha256: sha256(bytes), state, before, walking, errors };
    } finally {
      await context.close();
    }
  }

  async function compare(name, left, right) {
    const reference = await readFile(left.path);
    const candidate = await readFile(right.path);
    const result = await diffPage.evaluate(compareParityFrames,
      { reference: reference.toString('base64'), candidate: candidate.toString('base64') });
    assert.deepEqual([result.width, result.height], [viewport.width, viewport.height]);
    const diff = join(output, `${name}-diff.png`);
    await writeFile(diff, Buffer.from(result.png, 'base64'), { flag: 'wx' });
    return { changedPixels: result.changedPixels, outsideMaskPixels: result.outsideMaskPixels, diff };
  }

  // Production captures above are uninstrumented. Separately use the existing
  // Vite test seam to read primitive pose/environment values from old main,
  // which predates __game, and verify that both builds used the same route.
  async function probe(scenario) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await page.clock.install({ time: epoch });
      await page.clock.pauseAt(epoch + 1000);
      await page.route('**/src/main.ts*', async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        assert.match(body, /\bconst context\s*=/, 'Unknown Vite app entry point');
        await route.fulfill({ response, body: `${body}
window.__ebr77Probe = () => {
  const { character, camera, environment, dayNight } = context;
  return {
    player: { position: character.position.toArray(), yaw: character.rotation.y },
    clock: { ...environment.dayNight }, weather: { ...environment.weather },
    phase: dayNight.getPhase(), nightAmount: dayNight.getNightAmount(),
    camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), zoom: camera.zoom,
      left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom, near: camera.near, far: camera.far },
  };
};
` });
      });
      const query = new URLSearchParams({ seed: String(seed), phase: scenario.phase, weather: scenario.weather });
      await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?${query}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => typeof window.__ebr77Probe), 'function');
      await page.clock.runFor(16);
      const before = await page.evaluate(() => window.__ebr77Probe());
      await page.keyboard.down('w');
      await page.clock.runFor(800);
      const walking = await page.evaluate(() => window.__ebr77Probe());
      await page.keyboard.up('w');
      await page.clock.runFor(1000);
      await page.clock.runFor(16);
      const final = await page.evaluate(() => window.__ebr77Probe());
      assert.deepEqual(errors, []);
      return { before, walking, final, errors };
    } finally {
      await context.close();
    }
  }

  const common = (capture) => {
    const { date, elapsedNow, elapsedDate, dayNight, weather, pixel, phaseLabel, webgl, renderer } = capture.state;
    return { date, elapsedNow, elapsedDate, dayNight, weather, pixel, phaseLabel, webgl, renderer };
  };

  async function closeServer() {
    if (!server) return;
    if (typeof server.close === 'function') await server.close();
    else await new Promise((done, fail) => server.httpServer.close((error) => error ? fail(error) : done()));
    server = undefined;
  }

  async function archiveBuild(label, sha) {
    const archive = join(temp, `${label}.tar`);
    const archiveRoot = join(temp, label);
    await mkdir(archiveRoot);
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sha], { cwd: root });
    execFileSync('tar', ['-xf', archive, '-C', archiveRoot]);
    report.build[`${label}-verified`] = { sha, trackedFiles: await verifyBaselineArchive(archiveRoot, sha, root) };
    await command(`${label}-npm-ci`, 'npm', ['ci', '--include=dev', '--prefer-offline', '--no-audit', '--no-fund'], archiveRoot);
    await command(`${label}-build`, 'npm', ['run', 'build'], archiveRoot);
    return archiveRoot;
  }

  try {
    // Keep the temporary archived build under this run's external evidence;
    // only this uniquely created staging directory is removed afterwards.
    temp = await mkdtemp(join(output, '.baseline-'));
    const baselineRoot = await archiveBuild('main', baseline);
    const upstreamRoot = currentMain === baseline ? baselineRoot : await archiveBuild('current-main', currentMain);
    await command('head-build', 'npm', ['run', 'build'], root);

    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
    report.browser = `Chromium ${browser.version()}`;
    diffPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const sources = [['main', baselineRoot], ...(currentMain === baseline ? [] : [['upstream', upstreamRoot]]), ['head', root]];
    for (const [source, sourceRoot] of sources) {
      server = await preview({ root: sourceRoot, configFile: false, logLevel: 'error',
        preview: { host: '127.0.0.1', port: options.port, strictPort: Boolean(options.port) } });
      paths[source] = {};
      report.captures[source] = {};
      for (const scenario of selected) {
        paths[source][scenario.name] = {};
        report.captures[source][scenario.name] = {};
        for (const mode of source === 'upstream' ? [modes[0]] : modes) {
          const result = await capture(source, scenario, mode);
          paths[source][scenario.name][mode.name] = result;
          report.captures[source][scenario.name][mode.name] = result;
          console.log(`Captured ${source} ${scenario.name} ${mode.name}`);
        }
      }
      await closeServer();
      server = await createServer({ root: sourceRoot, configFile: false, logLevel: 'error',
        server: { host: '127.0.0.1', port: options.port, strictPort: Boolean(options.port), hmr: false } });
      await server.listen();
      report.probes[source] = {};
      for (const scenario of selected) {
        report.probes[source][scenario.name] = await probe(scenario);
        console.log(`Probed ${source} ${scenario.name} pose and environment`);
      }
      await closeServer();
    }
    for (const scenario of selected) {
      report.results[scenario.name] = {};
      for (const source of ['main', 'head']) {
        const runs = paths[source][scenario.name];
        report.results[scenario.name][source] = {};
        for (const [name, a, b] of pairs) {
          const result = await compare(`${source}-${scenario.name}-${name}`, runs[a], runs[b]);
          report.results[scenario.name][source][name] = result;
          assert.deepEqual(common(runs[a]), common(runs[b]), `${source}/${scenario.name}/${name} clock/environment mismatch`);
          if (source === 'head' && a === 'read' && b === 'both') {
            assert.deepEqual(runs[a].state.game, runs[b].state.game, `${scenario.name} snapshot differs with timing hook`);
          }
          console.log(`${source} ${scenario.name} ${name}: ${result.changedPixels} changed RGBA pixels`);
        }
        assert.deepEqual(runs.timing.state.timing.timestamps, runs.both.state.timing.timestamps,
          `${source}/${scenario.name} timing-hook frame timestamps differ`);
      }
      assert.deepEqual(common(paths.main[scenario.name].off), common(paths.head[scenario.name].off),
        `${scenario.name}: main/head clock or public environment mismatch`);
      for (const step of ['before', 'walking', 'final']) {
        const mainProbe = report.probes.main[scenario.name][step];
        const headProbe = report.probes.head[scenario.name][step];
        assert.deepEqual(mainProbe, headProbe, `${scenario.name}/${step}: main/head pose or environment mismatch`);
        const game = step === 'final' ? paths.head[scenario.name].read.state.game : paths.head[scenario.name].read[step];
        const { player, clock, weather, phase, nightAmount, camera } = game;
        assert.deepEqual({ player, clock, weather, phase, nightAmount, camera }, headProbe,
          `${scenario.name}/${step}: production snapshot differs from source probe`);
        if (currentMain !== baseline) assert.deepEqual(report.probes.upstream[scenario.name][step], headProbe,
          `${scenario.name}/${step}: current-main/head pose or environment mismatch`);
      }
      report.crossBaseline[scenario.name] = await compare(`main-vs-head-${scenario.name}`,
        paths.main[scenario.name].off, paths.head[scenario.name].off);
      console.log(`main ${baseline.slice(0, 7)} vs head ${scenario.name}: ${report.crossBaseline[scenario.name].changedPixels} changed RGBA pixels`);
      const current = paths[currentMain === baseline ? 'main' : 'upstream'][scenario.name].off;
      assert.deepEqual(common(current), common(paths.head[scenario.name].off), `${scenario.name}: current-main/head clock mismatch`);
      report.currentMainComparison[scenario.name] = await compare(`current-main-vs-head-${scenario.name}`,
        current, paths.head[scenario.name].off);
      assert.equal(report.currentMainComparison[scenario.name].changedPixels, 0,
        `${scenario.name}: pixels differ from the separately built current main`);
      console.log(`current main vs head ${scenario.name}: 0 changed RGBA pixels`);
    }
    const counts = Object.values(report.results).flatMap((scenario) => Object.values(scenario))
      .flatMap((source) => Object.values(source));
    assert.ok(counts.every((count) => count.changedPixels === 0 && count.outsideMaskPixels === 0), 'Hook-on/off pixel mismatch');
    assert.equal(git('rev-parse', 'HEAD'), head, 'Head changed during Gate G');
    assert.equal(git('rev-parse', 'origin/main'), currentMain, 'origin/main changed during Gate G');
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), sourceStatus, 'Worktree changed during Gate G');
    report.ok = true;
  } catch (error) {
    report.errors.push(error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    if (server) await closeServer().catch(() => {});
    await diffPage?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (temp) await rm(temp, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(`GATE G ${report.ok ? 'PASS' : 'FAIL'} report=${join(output, 'report.json')}`);
    if (!report.ok) {
      for (const error of report.errors) console.error(error);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
