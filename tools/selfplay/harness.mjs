#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { projectCheckpoint } from './projection.mjs';

const viewport = { width: 1280, height: 720 };
const seed = 123;
// These are world-space route checks, not teleports. They correspond to the
// visible pad and spawn in the current farm; a changed/missed route must fail.
const pad = [13.1, 0.16, 0.75];
const spawn = [0, 2.4, 0];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function parseArgs(args) {
  let output, port = 5252;
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === '--help') return { help: true };
    if (!['--output', '--port'].includes(name) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Usage: npm run play:harness -- [--output /absolute/directory] [--port 5252]');
    }
    const value = args[++i];
    if (name === '--output') {
      if (output || !isAbsolute(value)) throw new Error('--output must be a single absolute directory');
      output = resolve(value);
    } else {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new Error('--port must be an integer from 0 to 65535');
      port = Number(value);
    }
  }
  return { output, port };
}

// Check the real destination, including symlinked parents, before creating it.
async function resolvedDestination(path) {
  const missing = [];
  let parent = path;
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) throw new Error(`No existing ancestor for ${path}`);
    parent = next;
  }
  return resolve(await realpath(parent), ...missing);
}

function outside(root, path) {
  const rel = relative(root, path);
  return rel !== '' && (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run play:harness -- [--output /absolute/directory] [--port 5252]');
    return;
  }
  const root = await realpath(process.cwd());
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const head = git('rev-parse', 'HEAD');
  const sourceStatus = git('status', '--porcelain=v1', '--untracked-files=all');
  const output = options.output ?? join('/home/michael/OpenBot/Shared/farm-evidence/EBR-77', head.slice(0, 7),
    'selfplay', `${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`);
  const realOutput = await resolvedDestination(output);
  if (!outside(root, realOutput)) throw new Error('Self-play evidence must be outside the worktree');
  await mkdir(realOutput, { recursive: true });
  const reportPath = join(realOutput, 'report.json');
  if (existsSync(reportPath)) throw new Error(`Refusing to overwrite ${reportPath}`);

  const report = {
    version: 1, ok: false, head, sourceStatus, startedAt: new Date().toISOString(),
    viewport, deviceScaleFactor: 1, seed, url: null, browser: null, rendering: null,
    timing: 'live browser animation frames; no simulated time',
    fps: null, steps: [], trace: [], errors: { console: [], page: [], harness: [] },
  };
  let server, browser, context, page, cdp;
  let metricsStarted = false;

  async function snapshot() {
    return page.evaluate(() => {
      if (!window.__game) throw new Error('The opt-in inspection getter is missing');
      return window.__game;
    });
  }

  async function checkpoint(name, screenshot = true, observedState) {
    // Sample first: a live click route keeps moving while a screenshot is sent.
    const state = observedState ?? await snapshot();
    let image;
    if (screenshot) {
      const capture = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const bytes = Buffer.from(capture.data, 'base64');
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [viewport.width, viewport.height]);
      const path = join(realOutput, `${name}.png`);
      await writeFile(path, bytes, { flag: 'wx' });
      image = { path, sha256: hash(bytes) };
    }
    report.steps.push({ name, position: state.player.position, route: state.route,
      phase: state.phase, weather: state.weather, ...(image ? { screenshot: image } : {}) });
    return state;
  }

  async function clickWorld(point, label) {
    const state = await snapshot();
    const screen = projectCheckpoint(state.camera, point, viewport);
    assert.ok(screen.x >= 0 && screen.x < viewport.width && screen.y >= 0 && screen.y < viewport.height,
      `${label} is outside the viewport: ${JSON.stringify(screen)}`);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, screen), 'scene',
      `${label} is obscured by the HUD`);
    await page.mouse.click(screen.x, screen.y);
    const after = await checkpoint(`${label}-click`, false);
    assert.equal(after.route.status, 'following', `${label} click did not start a route`);
  }

  async function waitForBridge() {
    const handle = await page.waitForFunction(() => {
      const game = window.__game;
      const position = game?.player.position;
      return position && position[0] > 2.9 && position[0] < 4.9 && position[2] > -2.65 && position[2] < -1.25 && position[1] > 2.5
        ? game : false;
    }, null, { timeout: 45000 });
    const game = await handle.jsonValue();
    await handle.dispose();
    return game;
  }

  async function waitForDestination(point) {
    await page.waitForFunction(([x, , z]) => {
      const game = window.__game;
      return game && game.route.status === 'idle' && Math.hypot(game.player.position[0] - x, game.player.position[2] - z) < 0.04;
    }, point, { timeout: 60000 });
  }

  try {
    server = await createServer({ root, configFile: false, logLevel: 'error',
      server: { host: '127.0.0.1', port: options.port, strictPort: Boolean(options.port), hmr: false } });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    report.url = `http://127.0.0.1:${address.port}/?qa=1&seed=${seed}&phase=daytime&weather=clear`;
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
    report.browser = `Chromium ${browser.version()}`;
    context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page = await context.newPage();
    cdp = await context.newCDPSession(page);
    page.on('console', (message) => {
      if (message.type() === 'error') report.errors.console.push({ text: message.text(), location: message.location() });
    });
    page.on('pageerror', (error) => report.errors.page.push(error.stack || error.message));
    page.on('crash', () => report.errors.page.push('Browser page crashed'));
    await page.goto(report.url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => Boolean(window.__game));
    report.rendering = await page.evaluate(() => {
      const gl = document.querySelector('#scene')?.getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      return { webgl: gl?.getParameter(gl.VERSION) ?? null,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
        pixel: window.getPixelRendering() };
    });
    assert.match(report.rendering.webgl, /WebGL 2\.0/);
    assert.match(report.rendering.renderer, /SwiftShader/i);

    // This observer never replaces rAF or changes its timestamps. The engine
    // renders once per animation frame, so callbacks / real elapsed seconds
    // measure the running browser (including screenshot and observer overhead).
    await page.evaluate(() => {
      const start = performance.now();
      let frames = 0, running = true;
      const trace = [];
      function observe() {
        if (!running) return;
        const game = window.__game;
        if (game) {
          frames++;
          trace.push({ elapsedMs: performance.now() - start, position: [...game.player.position], route: game.route.status });
        }
        requestAnimationFrame(observe);
      }
      window.__selfplayMetrics = {
        stop() {
          running = false;
          return { frames, elapsedSeconds: (performance.now() - start) / 1000, trace };
        },
      };
      requestAnimationFrame(observe);
    });
    metricsStarted = true;
    const initial = await checkpoint('01-spawn');
    assert.ok(Math.hypot(initial.player.position[0] - spawn[0], initial.player.position[2] - spawn[2]) < 0.04,
      `Unexpected spawn: ${initial.player.position}`);

    await clickWorld(pad, '02-pad');
    const outboundBridge = await waitForBridge();
    await checkpoint('03-outbound-bridge', true, outboundBridge);
    await waitForDestination(pad);
    const bottom = await checkpoint('04-stair-pad');
    assert.ok(Math.abs(bottom.player.position[1] - pad[1]) < 0.02, `Missed the bottom of the stairs: ${bottom.player.position}`);

    await page.keyboard.down('w');
    await page.keyboard.down('a');
    try {
      await page.waitForFunction(() => {
        const position = window.__game?.player.position;
        return position && position[0] < 7.4 && Math.abs(position[1] - 2.4) < 0.01;
      }, null, { timeout: 45000 });
    } finally {
      await page.keyboard.up('a');
      await page.keyboard.up('w');
    }
    await checkpoint('05-climbed-stairs');
    await clickWorld(spawn, '06-return');
    const returnBridge = await waitForBridge();
    await checkpoint('07-return-bridge', true, returnBridge);
    await waitForDestination(spawn);
    await checkpoint('08-returned-to-spawn');
    const images = report.steps.filter((step) => step.screenshot);
    assert.equal(images.length, 6, 'Missing checkpoint screenshots');
    for (const step of images) {
      const bytes = await readFile(step.screenshot.path);
      assert.equal(hash(bytes), step.screenshot.sha256, `Screenshot changed or disappeared: ${step.name}`);
    }
    assert.deepEqual(report.errors.console, [], 'Browser console errors');
    assert.deepEqual(report.errors.page, [], 'Browser page errors');
    assert.equal(git('rev-parse', 'HEAD'), head, 'Head changed during self-play');
    assert.equal(git('status', '--porcelain=v1', '--untracked-files=all'), sourceStatus, 'Worktree changed during self-play');
    report.ok = true;
  } catch (error) {
    report.errors.harness.push(error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    if (metricsStarted) {
      try {
        const { frames, elapsedSeconds, trace } = await page.evaluate(() => window.__selfplayMetrics.stop());
        report.trace = trace;
        report.fps = { frames, elapsedSeconds, value: elapsedSeconds > 0 ? frames / elapsedSeconds : null,
          method: 'live requestAnimationFrame callbacks / performance.now elapsed seconds' };
        if (!frames || !Number.isFinite(report.fps.value)) {
          report.ok = false;
          report.errors.harness.push('No valid live frame-rate measurement');
        }
      } catch (error) {
        report.ok = false;
        report.errors.harness.push(`Frame measurement failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    if (report.errors.console.length || report.errors.page.length) report.ok = false;
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    console.log(`SELFPLAY ${report.ok ? 'PASS' : 'FAIL'} report=${reportPath}`);
    if (!report.ok) {
      for (const message of report.errors.harness) console.error(message);
      for (const message of report.errors.page) console.error(message);
      for (const message of report.errors.console) console.error(message.text);
      process.exitCode = 1;
    }
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exitCode = 1; });
