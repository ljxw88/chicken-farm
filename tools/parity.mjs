import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// The baseline is an archived commit, never the current working tree. Recording
// it is explicit so a normal candidate run cannot silently bless a regression.
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value`);
  return args[index + 1];
};
const recordBaseline = args.includes('--record-baseline');
const baselineSha = option('--baseline-sha');
const suppliedUrl = option('--url');
const evidence = resolve('evidence/EBR-73');
const viewport = { width: 1280, height: 720 };
const seed = 0xeb730001;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scenarios = [
  { name: 'spawn', search: '?phase=daytime&weather=clear', setup: 'spawn' },
  { name: 'stairs-pad', search: '?phase=daytime&weather=clear', setup: 'stairs' },
  { name: 'placement-ghost', search: '?phase=daytime&weather=clear', setup: 'placement' },
  { name: 'day', search: '?phase=daytime&weather=clear', setup: 'walk' },
  { name: 'night', search: '?phase=night&weather=clear', setup: 'spawn' },
  { name: 'rain', search: '?phase=daytime&weather=rain', setup: 'rain' },
  { name: 'cottage-coops-day', search: '?phase=daytime&weather=clear', setup: 'buildings' },
  { name: 'cottage-coops-night', search: '?phase=night&weather=clear', setup: 'buildings' },
];

if (recordBaseline && (!baselineSha || suppliedUrl)) {
  throw new Error('Record a baseline from Git: --record-baseline --baseline-sha <commit> (no --url)');
}
if (!recordBaseline && baselineSha) throw new Error('--baseline-sha is only for --record-baseline');

let temp;
let server;
let browser;
try {
  let root = process.cwd();
  let sourceSha;
  if (recordBaseline) {
    sourceSha = execFileSync('git', ['rev-parse', '--verify', `${baselineSha}^{commit}`], { encoding: 'utf8' }).trim();
    assert.equal(sourceSha, execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
      'Baseline must be origin/main at the time of recording');
    try {
      temp = await mkdtemp('/tmp/opencode/ebr73-parity-');
    } catch (error) {
      if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
      temp = await mkdtemp(join(tmpdir(), 'ebr73-parity-'));
    }
    const archive = join(temp, 'baseline.tar');
    root = join(temp, 'checkout');
    await mkdir(root);
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sourceSha, 'index.html', 'package.json', 'src']);
    execFileSync('tar', ['-xf', archive, '-C', root]);
    await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  }

  let baseUrl = suppliedUrl?.replace(/\/$/, '');
  if (!baseUrl) {
    server = await createServer({
      root, configFile: false, logLevel: 'error',
      server: { host: '127.0.0.1', port: 0, hmr: false },
    });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
  const browserVersion = browser.version();
  const output = join(evidence, recordBaseline ? 'baseline' : 'candidate');
  await mkdir(output, { recursive: true });
  const frames = {};
  for (const scenario of scenarios) {
    frames[scenario.name] = await captureScenario(browser, baseUrl, scenario, join(output, `${scenario.name}.png`));
    console.log(`Captured ${recordBaseline ? 'baseline' : 'candidate'} ${scenario.name}`);
  }

  if (recordBaseline) {
    await writeFile(join(evidence, 'baseline.json'), `${JSON.stringify({
      sourceSha, browser: browserVersion, viewport, deviceScaleFactor: 1, seed, scenarios, frames,
    }, null, 2)}\n`);
    console.log(`Baseline: ${sourceSha}`);
  } else {
    const baseline = JSON.parse(await readFile(join(evidence, 'baseline.json'), 'utf8'));
    assert.equal(browserVersion, baseline.browser, 'Use the same Chromium version as the baseline');
    assert.deepEqual(baseline.viewport, viewport);
    assert.equal(baseline.deviceScaleFactor, 1);
    assert.equal(baseline.seed, seed);
    assert.deepEqual(baseline.scenarios, scenarios, 'Capture scenarios differ from the recorded baseline');
    const diffDir = join(evidence, 'diff');
    await mkdir(diffDir, { recursive: true });
    const diffPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    const results = {};
    const stateMismatches = [];
    for (const { name } of scenarios) {
      const reference = await readFile(join(evidence, 'baseline', `${name}.png`));
      const candidate = await readFile(join(output, `${name}.png`));
      assert.equal(sha256(reference), baseline.frames[name].sha256, `Baseline image changed: ${name}`);
      for (const key of ['position', 'yaw', 'camera', 'cameraQuaternion', 'cameraZoom', 'pixel', 'weather', 'phase', 'buildings']) {
        if (!isDeepStrictEqual(frames[name][key], baseline.frames[name][key])) stateMismatches.push(`${name}: ${key}`);
      }
      const diff = await diffPage.evaluate(async ({ reference, candidate }) => {
        async function decode(data) {
          const image = new Image();
          image.src = `data:image/png;base64,${data}`;
          await image.decode();
          return image;
        }
        const [a, b] = await Promise.all([decode(reference), decode(candidate)]);
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
        const result = context.createImageData(a.width, a.height);
        let changedPixels = 0;
        for (let i = 0; i < original.data.length; i += 4) {
          const changed = original.data[i] !== current.data[i] || original.data[i + 1] !== current.data[i + 1] ||
            original.data[i + 2] !== current.data[i + 2] || original.data[i + 3] !== current.data[i + 3];
          if (changed) {
            changedPixels++;
            result.data[i] = 255;
            result.data[i + 2] = 255;
          }
          result.data[i + 3] = 255;
        }
        context.putImageData(result, 0, 0);
        return { changedPixels, width: a.width, height: a.height, png: canvas.toDataURL('image/png').split(',')[1] };
      }, { reference: reference.toString('base64'), candidate: candidate.toString('base64') });
      assert.deepEqual([diff.width, diff.height], [viewport.width, viewport.height]);
      await writeFile(join(diffDir, `${name}.png`), Buffer.from(diff.png, 'base64'));
      results[name] = { changedPixels: diff.changedPixels, width: diff.width, height: diff.height };
      console.log(`${name}: ${diff.changedPixels} changed pixels`);
    }
    await diffPage.close();
    const candidateSha = suppliedUrl ? null : execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sourceStatus = suppliedUrl ? null : execFileSync('git', [
      'status', '--porcelain=v1', '--untracked-files=all', '--', 'src', 'index.html', 'package.json', 'package-lock.json', 'tools/parity.mjs',
    ], { encoding: 'utf8' }).trim();
    await writeFile(join(evidence, 'parity.json'), `${JSON.stringify({
      baselineSha: baseline.sourceSha, candidateSha, candidateUrl: suppliedUrl ?? 'local Vite (working tree)',
      sourceStatus, browser: browserVersion, viewport, deviceScaleFactor: 1, seed, results, stateMismatches, frames,
    }, null, 2)}\n`);
    assert.ok(Object.values(results).every((result) => result.changedPixels === 0), 'Gate G: pixel differences found');
    assert.deepEqual(stateMismatches, [], 'Gate G: pose, camera or environment differs from the baseline');
  }
} finally {
  await browser?.close();
  await server?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
}

async function captureScenario(browser, baseUrl, scenario, path) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  try {
    // Time and the RNG are installed before any app modules are evaluated. The
    // app's own renderer.setAnimationLoop is stepped at known timestamps.
    await page.addInitScript(({ seed }) => {
      let state = seed >>> 0;
      window.__ebr73RandomCalls = 0;
      window.__ebr73Random = () => {
        window.__ebr73RandomCalls++;
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__ebr73Step = (time) => {
        const current = [...callbacks.values()];
        callbacks.clear();
        if (current.length === 0) throw new Error('No animation frame was scheduled');
        for (const callback of current) callback(time);
      };
    }, { seed });
    // Like the existing browser tests, instrument the served Vite module only.
    // Supplying random here reaches createRainEffect at construction, including
    // its initial particle positions; normal app initialization is unchanged.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      const matches = body.match(/\bcreateWeatherSystem\(\{/g) ?? [];
      assert.equal(matches.length, 1, 'Expected one weather initialization in the Vite main module');
      await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr73Random,')}
window.__ebr73Parity = { scene, camera, character, controls, follow, stairs, renderer, composer, placement };
` });
    });
    await page.goto(`${baseUrl}/${scenario.search}`, { waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => Boolean(window.__ebr73Parity)), 'URL must serve the Vite development source module');
    const initialRandomCalls = await page.evaluate(() => window.__ebr73RandomCalls);
    assert.ok(initialRandomCalls > 0, 'The seeded RNG must be used during rain initialization, before the first frame');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__ebr73Step(0));

    if (scenario.setup === 'stairs') {
      const point = await page.evaluate(() => {
        const { camera, character, stairs } = window.__ebr73Parity;
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
      await page.evaluate(() => { for (let i = 1; i <= 50; i++) window.__ebr73Step(i * 100); });
      const distance = await page.evaluate(() => {
        const { character, stairs } = window.__ebr73Parity;
        return Math.hypot(character.position.x - stairs.footPad.position.x, character.position.z - stairs.footPad.position.z);
      });
      assert.ok(distance < 0.03, `Click-walk did not reach stairs pad: ${distance}`);
    } else if (scenario.setup === 'placement') {
      await page.keyboard.press('f');
      await page.mouse.move(449, 381);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      await page.evaluate(() => window.__ebr73Step(100));
      assert.equal(await page.evaluate(() => window.__ebr73Parity.scene.getObjectByName('placement-ghost')?.visible), true);
    } else if (scenario.setup === 'walk') {
      await page.keyboard.down('s');
      await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__ebr73Step(i * 100); });
      await page.keyboard.up('s');
      assert.ok(await page.evaluate(() => window.__ebr73Parity.character.position.length()) > 2.5);
    } else if (scenario.setup === 'rain') {
      await page.evaluate(() => { for (let i = 1; i <= 25; i++) window.__ebr73Step(i * 100); });
      assert.equal(await page.evaluate(() => window.getWeather().rainAmount), 1);
    } else if (scenario.setup === 'buildings') {
      // Test-only framing: keep the normal isometric/front direction, move the
      // camera's focus toward the buildings, and zoom. Gameplay state is not
      // teleported or modified; use the existing composer for the final draw.
      await page.evaluate(() => {
        const { camera, character, follow, composer } = window.__ebr73Parity;
        follow(character.position.clone().set(-1.45, 2.4, -3.4));
        camera.zoom = 1.8;
        camera.updateProjectionMatrix();
        composer.render(0);
      });
    }
    const state = await page.evaluate((inspectBuildings) => {
      const { scene, camera, character } = window.__ebr73Parity;
      const gl = document.querySelector('#scene').getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      let buildings;
      if (inspectBuildings) {
        scene.updateMatrixWorld(true);
        const names = ['farm-cottage', 'farm-ramp-coop-1', 'farm-ramp-coop-2'];
        const centers = names.map((name) => {
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
      return {
        position: character.position.toArray(), yaw: character.rotation.y, camera: camera.position.toArray(),
        cameraQuaternion: camera.quaternion.toArray(), cameraZoom: camera.zoom, buildings,
        pixel: window.getPixelRendering(), weather: window.getWeather(), webgl: gl?.getParameter(gl.VERSION),
        renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), randomCalls: window.__ebr73RandomCalls,
        phase: document.querySelector('[data-phase]')?.textContent,
      };
    }, scenario.setup === 'buildings');
    assert.match(state.webgl, /WebGL 2\.0/);
    assert.match(state.renderer, /SwiftShader/i);
    assert.equal(state.pixel.enabled, true);
    assert.equal(state.pixel.devicePixelRatio, 1);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight], [320, 180]);
    assert.equal(state.phase, scenario.search.includes('phase=night') ? 'Night' : 'Daytime');
    assert.equal(state.weather.mode, scenario.setup === 'rain' ? 'rain' : 'clear');
    if (state.buildings) {
      assert.ok(state.buildings.centers.every(({ visible, x, y }) => visible && Math.abs(x) < 1 && Math.abs(y) < 1),
        'Cottage and both coop centers must be in the framed view');
      const night = state.phase === 'Night';
      const expected = night ? [0.85, 0.85, 0.85, 0.595, 0.595] : [0, 0, 0, 0, 0];
      state.buildings.accents.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9));
      state.buildings.windowLights.forEach((value) => assert.ok(Math.abs(value - (night ? 0.85 : 0)) < 1e-9));
    }
    assert.deepEqual(errors, []);
    // CDP capture avoids Playwright's rAF-based screenshot stability wait: the
    // test intentionally owns requestAnimationFrame and advances it manually.
    const cdp = await context.newCDPSession(page);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const bytes = Buffer.from(screenshot.data, 'base64');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [viewport.width, viewport.height]);
    await writeFile(path, bytes);
    await cdp.detach();
    return { ...state, initialRandomCalls, sha256: sha256(bytes) };
  } finally {
    await context.close();
  }
}
