import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { approachStairsAcrossBridge } from './parity-bridge-route.mjs';

// Based on the EBR-73 Gate G harness. Main did not yet contain that tool.
// Baselines are explicit archived commits; a comparison never re-records one.
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
const recording = args.includes('--record-baseline');
const baselineRef = value('--baseline-sha');
const suppliedUrl = value('--url');
if (recording && (!baselineRef || suppliedUrl)) throw new Error('Use --record-baseline --baseline-sha <origin/main SHA>');
if (!recording && baselineRef) throw new Error('--baseline-sha is only valid when recording');
const evidence = resolve('evidence/lighting/parity');
const viewport = { width: 1280, height: 720 };
const seed = 0xeb730001;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scenarios = [
  { name: 'spawn', phase: 'daytime', weather: 'clear', setup: 'spawn' },
  { name: 'stairs-pad', phase: 'daytime', weather: 'clear', setup: 'stairs' },
  { name: 'placement-ghost', phase: 'daytime', weather: 'clear', setup: 'placement' },
  { name: 'day', phase: 'daytime', weather: 'clear', setup: 'walk' },
  { name: 'sunset', phase: 'sunset', weather: 'clear', setup: 'spawn' },
  { name: 'night', phase: 'night', weather: 'clear', setup: 'spawn' },
  { name: 'rain', phase: 'daytime', weather: 'rain', setup: 'weather' },
  { name: 'cloudy', phase: 'daytime', weather: 'cloudy', setup: 'weather' },
  { name: 'cottage-coops-day', phase: 'daytime', weather: 'clear', setup: 'buildings' },
  { name: 'cottage-coops-night', phase: 'night', weather: 'clear', setup: 'buildings' },
];

let temp;
let server;
let browser;
try {
  let root = process.cwd();
  let sourceSha;
  if (recording) {
    sourceSha = execFileSync('git', ['rev-parse', '--verify', `${baselineRef}^{commit}`], { encoding: 'utf8' }).trim();
    assert.equal(sourceSha, execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
      'Record the actual origin/main commit, not the working tree');
    try { temp = await mkdtemp('/tmp/opencode/chicken-parity-'); }
    catch (error) {
      if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
      temp = await mkdtemp(join(tmpdir(), 'chicken-parity-'));
    }
    const archive = join(temp, 'baseline.tar');
    root = join(temp, 'checkout');
    await mkdir(root);
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sourceSha, 'index.html', 'package.json', 'src']);
    execFileSync('tar', ['-xf', archive, '-C', root]);
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  }
  let url = suppliedUrl?.replace(/\/$/, '');
  if (!url) {
    server = await createServer({ root, configFile: false, logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, hmr: false } });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    url = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
  const output = join(evidence, recording ? 'baseline' : 'candidate');
  await mkdir(output, { recursive: true });
  const frames = {};
  for (const scenario of scenarios) {
    frames[scenario.name] = await capture(browser, url, scenario, join(output, `${scenario.name}.png`));
    console.log(`Captured ${recording ? 'baseline' : 'candidate'} ${scenario.name}`);
  }
  if (recording) {
    await writeFile(join(evidence, 'baseline.json'), `${JSON.stringify({
      sourceSha, browser: browser.version(), viewport, deviceScaleFactor: 1, seed, scenarios, frames,
    }, null, 2)}\n`);
    console.log(`Baseline: ${sourceSha}`);
  } else {
    const baseline = JSON.parse(await readFile(join(evidence, 'baseline.json'), 'utf8'));
    assert.equal(browser.version(), baseline.browser, 'Use the same Chromium version as the baseline');
    assert.deepEqual(baseline.viewport, viewport);
    assert.equal(baseline.deviceScaleFactor, 1);
    assert.equal(baseline.seed, seed);
    assert.deepEqual(baseline.scenarios, scenarios);
    const diffDir = join(evidence, 'diff');
    await mkdir(diffDir, { recursive: true });
    const diffPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const results = {};
    const stateMismatches = [];
    for (const { name } of scenarios) {
      const before = await readFile(join(evidence, 'baseline', `${name}.png`));
      const after = await readFile(join(output, `${name}.png`));
      assert.equal(hash(before), baseline.frames[name].sha256, `Baseline image changed: ${name}`);
      for (const key of ['position', 'yaw', 'camera', 'cameraQuaternion', 'cameraZoom', 'pixel', 'weather', 'phase', 'buildings']) {
        if (!isDeepStrictEqual(frames[name][key], baseline.frames[name][key])) stateMismatches.push(`${name}: ${key}`);
      }
      const diff = await diffPage.evaluate(async ({ before, after }) => {
        const decode = async (data) => {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          return image;
        };
        const [a, b] = await Promise.all([decode(before), decode(after)]);
        if (a.width !== b.width || a.height !== b.height) throw new Error('Frame dimensions differ');
        const canvas = document.createElement('canvas');
        canvas.width = a.width;
        canvas.height = a.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(a, 0, 0);
        const original = context.getImageData(0, 0, a.width, a.height);
        context.clearRect(0, 0, a.width, a.height);
        context.drawImage(b, 0, 0);
        const current = context.getImageData(0, 0, a.width, a.height);
        const difference = context.createImageData(a.width, a.height);
        let changedPixels = 0;
        for (let i = 0; i < original.data.length; i += 4) {
          if (original.data[i] !== current.data[i] || original.data[i + 1] !== current.data[i + 1] ||
              original.data[i + 2] !== current.data[i + 2] || original.data[i + 3] !== current.data[i + 3]) {
            changedPixels++;
            difference.data[i] = 255;
            difference.data[i + 2] = 255;
          }
          difference.data[i + 3] = 255;
        }
        context.putImageData(difference, 0, 0);
        return { changedPixels, width: a.width, height: a.height, png: canvas.toDataURL('image/png').split(',')[1] };
      }, { before: before.toString('base64'), after: after.toString('base64') });
      assert.deepEqual([diff.width, diff.height], [viewport.width, viewport.height]);
      await writeFile(join(diffDir, `${name}.png`), Buffer.from(diff.png, 'base64'));
      results[name] = { changedPixels: diff.changedPixels, width: diff.width, height: diff.height };
      console.log(`${name}: ${diff.changedPixels} changed pixels`);
    }
    await diffPage.close();
    const candidateSha = suppliedUrl ? null : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sourceStatus = suppliedUrl ? null : execFileSync('git', [
      'status', '--porcelain=v1', '--untracked-files=all', '--', 'src', 'index.html', 'package.json', 'package-lock.json', 'tools/lighting-parity.mjs',
    ], { encoding: 'utf8' }).trim();
    await writeFile(join(evidence, 'parity.json'), `${JSON.stringify({ baselineSha: baseline.sourceSha, candidateSha,
      candidateUrl: suppliedUrl ?? 'local Vite (working tree)', sourceStatus, browser: browser.version(),
      viewport, deviceScaleFactor: 1, seed, results, stateMismatches, frames }, null, 2)}\n`);
    assert.ok(Object.values(results).every((result) => result.changedPixels === 0), 'Gate G: pixel differences found');
    assert.deepEqual(stateMismatches, [], 'Gate G: pose, camera or environment differs from baseline');
  }
} finally {
  await browser?.close();
  await server?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
}

async function capture(browser, url, scenario, path) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  try {
    await page.addInitScript(({ seed }) => {
      let state = seed >>> 0;
      window.__parityRandomCalls = 0;
      window.__parityRandom = () => {
        window.__parityRandomCalls++;
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__parityStep = (time) => {
        const current = [...callbacks.values()];
        callbacks.clear();
        if (!current.length) throw new Error('No animation frame was scheduled');
        for (const callback of current) callback(time);
      };
    }, { seed });
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
      await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__parityRandom,')}\nwindow.__parity = { scene, camera, character, controls, follow, stairs, renderer, composer, placement };\n` });
    });
    await page.goto(`${url}/?phase=${scenario.phase}&weather=${scenario.weather}`, { waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => Boolean(window.__parity)), 'A Vite source URL is required');
    assert.ok(await page.evaluate(() => window.__parityRandomCalls) > 0, 'Rain RNG must be seeded at initialization');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__parityStep(0));
    if (scenario.setup === 'stairs') {
      if (await page.evaluate(() => Boolean(window.__parity.scene.getObjectByName('farm-water-feature')))) {
        await approachStairsAcrossBridge(page, '__parity', '__parityStep');
      } else {
        const point = await page.evaluate(() => {
          const { camera, character, stairs } = window.__parity;
          const pad = stairs.footPad;
          const p = pad.getWorldPosition(character.position.clone());
          p.y += pad.geometry.parameters.height / 2;
          camera.updateMatrixWorld();
          p.project(camera);
          const rect = document.querySelector('#scene').getBoundingClientRect();
          return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
        });
        assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
        await page.mouse.click(point.x, point.y);
        await page.evaluate(() => { for (let i = 1; i <= 50; i++) window.__parityStep(i * 100); });
      }
      const distance = await page.evaluate(() => Math.hypot(window.__parity.character.position.x - window.__parity.stairs.footPad.position.x,
        window.__parity.character.position.z - window.__parity.stairs.footPad.position.z));
      assert.ok(distance < 0.03, `Click-walk did not reach stairs pad: ${distance}`);
    } else if (scenario.setup === 'placement') {
      await page.keyboard.press('f');
      await page.mouse.move(449, 381);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      await page.evaluate(() => window.__parityStep(100));
      assert.equal(await page.evaluate(() => window.__parity.scene.getObjectByName('placement-ghost')?.visible), true);
    } else if (scenario.setup === 'walk') {
      await page.keyboard.down('s');
      await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__parityStep(i * 100); });
      await page.keyboard.up('s');
      assert.ok(await page.evaluate(() => window.__parity.character.position.length()) > 2.5);
    } else if (scenario.setup === 'weather') {
      await page.evaluate(() => { for (let i = 1; i <= 25; i++) window.__parityStep(i * 100); });
      assert.equal(await page.evaluate((weather) => window.getWeather()[`${weather}Amount`], scenario.weather), 1);
    } else if (scenario.setup === 'buildings') {
      await page.evaluate(() => {
        const { camera, character, follow, composer } = window.__parity;
        follow(character.position.clone().set(-1.45, 2.4, -3.4));
        camera.zoom = 1.8;
        camera.updateProjectionMatrix();
        composer.render(0);
      });
    }
    const state = await page.evaluate((inspectBuildings) => {
      const { scene, camera, character } = window.__parity;
      const gl = document.querySelector('#scene').getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      let buildings;
      if (inspectBuildings) {
        scene.updateMatrixWorld(true);
        const centers = ['farm-cottage', 'farm-ramp-coop-1', 'farm-ramp-coop-2'].map((name) => {
          const building = scene.getObjectByName(name);
          if (!building) throw new Error(`Missing building: ${name}`);
          const p = building.getWorldPosition(character.position.clone());
          p.y += 0.8;
          p.project(camera);
          return { name, visible: building.visible, x: p.x, y: p.y };
        });
        const accents = ['cottage-window-1', 'cottage-window-2', 'cottage-east-window',
          'ramp-coop-1-pop-hole-glow', 'ramp-coop-2-pop-hole-glow']
          .map((name) => scene.getObjectByName(name).material.emissiveIntensity);
        const windowLights = ['window-light-1', 'window-light-2'].map((name) => scene.getObjectByName(name).intensity);
        buildings = { centers, accents, windowLights };
      }
      return { position: character.position.toArray(), yaw: character.rotation.y, camera: camera.position.toArray(),
        cameraQuaternion: camera.quaternion.toArray(), cameraZoom: camera.zoom, buildings,
        pixel: window.getPixelRendering(), weather: window.getWeather(), webgl: gl?.getParameter(gl.VERSION),
        renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), randomCalls: window.__parityRandomCalls,
        phase: document.querySelector('[data-phase]')?.textContent };
    }, scenario.setup === 'buildings');
    assert.match(state.webgl, /WebGL 2\.0/);
    assert.match(state.renderer, /SwiftShader/i);
    assert.equal(state.pixel.enabled, true);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight], [320, 180]);
    assert.equal(state.phase.toLowerCase(), scenario.phase);
    assert.equal(state.weather.mode, scenario.weather);
    if (state.buildings) {
      assert.ok(state.buildings.centers.every(({ visible, x, y }) => visible && Math.abs(x) < 1 && Math.abs(y) < 1));
      const expected = scenario.phase === 'night' ? [0.85, 0.85, 0.85, 0.595, 0.595] : [0, 0, 0, 0, 0];
      state.buildings.accents.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-9));
      state.buildings.windowLights.forEach((v) => assert.ok(Math.abs(v - (scenario.phase === 'night' ? 0.85 : 0)) < 1e-9));
    }
    assert.deepEqual(errors, []);
    // CDP avoids waiting on rAF, which this test deliberately controls.
    const cdp = await context.newCDPSession(page);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const bytes = Buffer.from(screenshot.data, 'base64');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [viewport.width, viewport.height]);
    await writeFile(path, bytes);
    await cdp.detach();
    return { ...state, sha256: hash(bytes) };
  } finally {
    await context.close();
  }
}
