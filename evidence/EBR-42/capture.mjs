import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { approachStairsAcrossBridge } from '../../tools/parity-bridge-route.mjs';

// Gate G against an archived clean main: same seeded weather, controlled frame
// times, camera, pose and pixel pass. All instrumentation is response-only.
const expectedMain = '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff';
const signedHead = '9305bd41ed71f1d885646ac5d9b1bc145fb2594e';
const seed = 0xeb730001;
const candidateUrl = (process.env.EBR42_URL || 'http://100.88.150.21:5212').replace(/\/$/, '');
const output = resolve('evidence/EBR-42');
const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const sourceStatus = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--',
  'src', 'index.html', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim();
assert.equal(sourceStatus, '', 'Commit the candidate source before capturing evidence');
const readability = JSON.parse(await readFile(join(output, 'smoke-retune/readability.json'), 'utf8'));
assert.equal(readability.head, candidateHead, 'Regenerate per-puff measurements for this source tip first');
assert.deepEqual(readability.failures, [], 'Smoke composite-contribution or selected independent checks failed');
const viewport = { width: 1280, height: 720 };
const matrix = ['morning', 'daytime', 'sunset', 'night'].flatMap((phase) =>
  ['clear', 'cloudy', 'rain'].map((weather) => ({ name: `${phase}-${weather}`, phase, weather, setup: 'spawn' })));
const scenarios = [...matrix,
  { name: 'walk-night-clear', phase: 'night', weather: 'clear', setup: 'walk' },
  { name: 'placement-night-clear', phase: 'night', weather: 'clear', setup: 'placement' },
  { name: 'stairs-daytime-clear', phase: 'daytime', weather: 'clear', setup: 'stairs' },
];
const hash = (data) => createHash('sha256').update(data).digest('hex');
for (const name of ['baseline', 'candidate', 'no-effects', 'diff', 'mask/smoke', 'mask/fireflies', 'mask/combined',
  'mask/smoke-retune', 'smoke-retune/before', 'smoke-retune/diff', 'smoke-retune/crops', 'crops']) {
  await mkdir(join(output, name), { recursive: true });
}

const sha = execFileSync('git', ['rev-parse', '--verify', `${expectedMain}^{commit}`], { encoding: 'utf8' }).trim();
assert.equal(sha, expectedMain);
assert.equal(execFileSync('git', ['rev-parse', '--verify', `${signedHead}^{commit}`], { encoding: 'utf8' }).trim(), signedHead);
execFileSync('git', ['diff', '--quiet', signedHead, 'HEAD', '--', 'src/effects/createFireflies.ts', 'tests/fireflies.test.mjs']);
const signedReport = JSON.parse(execFileSync('git', ['show', `${signedHead}:evidence/EBR-42/comparison.json`], { encoding: 'utf8' }));
execFileSync('git', ['diff', '--quiet', signedReport.candidateHead, signedHead, '--', 'src', 'index.html', 'package.json', 'package-lock.json']);
let temp;
try { temp = await mkdtemp('/tmp/opencode/ebr42-main-'); }
catch (error) {
  if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
  temp = await mkdtemp(join(tmpdir(), 'ebr42-archive-'));
}
let server;
let browser;
try {
  const archive = join(temp, 'main.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, sha, 'index.html', 'package.json', 'package-lock.json', 'src']);
  execFileSync('tar', ['-xf', archive, '-C', temp]);
  await symlink(resolve('node_modules'), join(temp, 'node_modules'), 'dir');
  server = await createServer({ root: temp, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [temp, process.cwd()] } } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const mainUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
  assert.equal(browser.version(), signedReport.browser, 'Use the same Chromium version as the signed firefly capture');
  assert.equal(signedReport.seed, seed, 'Signed firefly seed differs');
  assert.deepEqual(signedReport.viewport, viewport);
  assert.equal(signedReport.deviceScaleFactor, 1);
  const comparisonPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const report = { main: sha, signedHead, candidateHead, sourceStatus, candidateUrl, browser: browser.version(), viewport, deviceScaleFactor: 1,
    seed, time: '3.0 s in 100 ms steps except stairs (real click route)', cases: {}, retuneCrops: {} };

  for (const scenario of scenarios) {
    const before = await capture(mainUrl, scenario, false);
    const after = await capture(candidateUrl, scenario, true);
    assert.deepEqual(after.state, before.state, `${scenario.name}: camera, gameplay, lights or weather changed`);
    const signed = signedReport.cases[scenario.name];
    assert.deepEqual(after.state, signed.state, `${scenario.name}: state differs from the signed head`);
    assert.deepEqual(after.effectState.fireflyOpacity, signed.effectState.fireflyOpacity, `${scenario.name}: firefly opacity changed`);
    const result = await compare(comparisonPage, before.image, after);
    const fromSigned = (folder) => execFileSync('git', ['show', `${signedHead}:evidence/EBR-42/${folder}/${scenario.name}.png`]);
    const signedFrame = fromSigned('candidate');
    const signedSmoke = fromSigned('mask/smoke');
    const signedFlies = fromSigned('mask/fireflies');
    const retune = await compareRetune(comparisonPage, signedFrame, after.image, signedSmoke,
      Buffer.from(result.smokePng, 'base64'), signedFlies, Buffer.from(result.firefliesPng, 'base64'));
    let puffBrightMaskOutside = null;
    if (readability.cases[scenario.name]) {
      const measured = readability.cases[scenario.name].samples.find((sample) => sample.time === 3);
      assert.ok(measured, `Missing t=3 smoke measurement: ${scenario.name}`);
      const puffState = (puff) => ({ name: puff.name, position: puff.position, size: puff.size, opacity: puff.opacity });
      assert.deepEqual(after.effectState.smokePuffs.map(puffState), measured.puffs.map(puffState),
        `${scenario.name}: per-puff measurements do not match the captured frame`);
      const masks = await Promise.all(measured.puffs.map((puff) =>
        readFile(join(output, 'mask/puff-bright', `${scenario.name}-${puff.name}.png`))));
      puffBrightMaskOutside = await countMaskOutside(comparisonPage, Buffer.from(result.smokePng, 'base64'), masks);
      assert.equal(puffBrightMaskOutside, 0, `${scenario.name}: bright-puff masks exceed the smoke mask`);
    }
    const save = async (name, data) => writeFile(join(output, name, `${scenario.name}.png`), data);
    await save('baseline', before.image);
    await save('candidate', after.image);
    await save('no-effects', after.hidden);
    await save('diff', Buffer.from(result.diffPng, 'base64'));
    await save('mask/smoke', Buffer.from(result.smokePng, 'base64'));
    await save('mask/fireflies', Buffer.from(result.firefliesPng, 'base64'));
    await save('mask/combined', Buffer.from(result.combinedPng, 'base64'));
    await save('mask/smoke-retune', Buffer.from(retune.maskPng, 'base64'));
    await save('smoke-retune/before', signedFrame);
    await save('smoke-retune/diff', Buffer.from(retune.diffPng, 'base64'));
    assert.equal(result.unmasked, 0, `${scenario.name}: changes outside rendered effect masks`);
    assert.equal(result.hiddenChanged, 0, `${scenario.name}: hiding effects did not restore clean main`);
    assert.ok(result.fireflies.maximum.every((value) => value < 250), `${scenario.name}: firefly output reached 250`);
    assert.equal(result.fireflies.voidBackground, 0, `${scenario.name}: firefly rendered over the void`);
    assert.equal(retune.outsideSmoke, 0, `${scenario.name}: retune changed pixels outside old/new smoke masks`);
    assert.equal(retune.fireflyMaskChanged, 0, `${scenario.name}: signed firefly pixels changed`);
    if (scenario.setup === 'spawn') {
      const expected = scenario.phase !== 'night' ? 0 : { clear: 14, cloudy: 10, rain: 6 }[scenario.weather];
      assert.equal(after.effectState.activeFireflies, expected, `${scenario.name}: wrong firefly count`);
      assert.ok(result.smoke.changed > 0, `${scenario.name}: no smoke visible`);
      if (expected) assert.ok(result.fireflies.changed > 0, `${scenario.name}: no fireflies visible`);
      else assert.equal(result.fireflies.changed, 0);
    }
    const { diffPng, smokePng, firefliesPng, combinedPng, ...metrics } = result;
    const { diffPng: retuneDiff, maskPng: retuneMask, ...retuneMetrics } = retune;
    report.cases[scenario.name] = { ...metrics, state: after.state, effectState: after.effectState,
      retune: retuneMetrics, puffBrightMaskOutside, renderCalls: after.renderCalls, baselineSha256: hash(before.image), candidateSha256: hash(after.image),
      errors: { baseline: before.errors, candidate: after.errors },
      faviconErrors: { baseline: before.faviconErrors, candidate: after.faviconErrors } };
    if (['daytime-clear', 'daytime-rain', 'sunset-clear', 'sunset-rain',
      'night-clear', 'night-cloudy', 'night-rain'].includes(scenario.name)) {
      const crops = await makeRetuneCrops(comparisonPage, signedFrame, after.image, retune.maskPng,
        signed.smoke.bounds, result.smoke.bounds);
      for (const [name, data] of Object.entries(crops.images)) {
        await writeFile(join(output, 'smoke-retune/crops', `${scenario.name}-${name}.png`), Buffer.from(data, 'base64'));
      }
      report.retuneCrops[scenario.name] = crops.rectangle;
    }
    if (scenario.name === 'night-clear') {
      const crops = await makeCrops(comparisonPage, before.image, after.image, result);
      for (const [name, data] of Object.entries(crops.images)) {
        await writeFile(join(output, 'crops', `${name}.png`), Buffer.from(data, 'base64'));
      }
      report.crops = crops.rectangles;
    }
    console.log(`${scenario.name}: ${result.rawChanged} vs main, ${retune.changedPixels} vs signed; ` +
      `${result.unmasked}/${retune.outsideSmoke} outside masks, ${retune.fireflyMaskChanged} firefly-mask changes`);
  }

  const replay = await capture(candidateUrl, matrix.find((item) => item.name === 'night-rain'), true);
  report.nightRainReplay = { sha256: hash(replay.image), matches: hash(replay.image) === report.cases['night-rain'].candidateSha256 };
  assert.equal(report.nightRainReplay.matches, true, 'seeded night-rain frame did not replay exactly');
  await writeFile(join(output, 'comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
  await comparisonPage.close();
  console.log(`Gate G PASS: ${scenarios.length} main and signed-head frames, exact masks, unchanged fireflies, seeded replay`);
} finally {
  await browser?.close();
  await server?.close();
  await rm(temp, { recursive: true });
}

async function capture(url, scenario, candidate) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  const faviconErrors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      (message.location().url.endsWith('/favicon.ico') ? faviconErrors : errors).push(message.text());
    }
  });
  try {
    await page.addInitScript(({ seed }) => {
      let state = seed >>> 0;
      window.__ebr42Random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__ebr42LastTime = 0;
      window.__ebr42Step = (time) => {
        window.__ebr42LastTime = time;
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
      const patched = body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr42Random,');
      await route.fulfill({ response, body: `${patched}\nwindow.__ebr42 = { scene, camera, character, controls, follow, stairs, renderer, composer, placement, obstacles };\n` });
    });
    await page.goto(`${url}/?phase=${scenario.phase}&weather=${scenario.weather}&seed=${seed}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__ebr42));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__ebr42Step(0));
    if (scenario.setup === 'walk') {
      await page.keyboard.down('s');
      await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__ebr42Step(i * 100); });
      await page.keyboard.up('s');
    } else if (scenario.setup === 'placement') {
      await page.keyboard.press('f');
      await page.mouse.move(449, 381);
      await page.evaluate(() => window.__ebr42Step(100));
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
    } else if (scenario.setup === 'stairs') {
      await approachStairsAcrossBridge(page, '__ebr42', '__ebr42Step');
      const distance = await page.evaluate(() => {
        const { character, stairs } = window.__ebr42;
        return Math.hypot(character.position.x - stairs.footPad.position.x, character.position.z - stairs.footPad.position.z);
      });
      assert.ok(distance < 0.03, `stairs pad not reached: ${distance}`);
    }
    await page.evaluate(() => {
      for (let time = window.__ebr42LastTime + 100; time <= 3000; time += 100) window.__ebr42Step(time);
    });
    const state = await page.evaluate(() => {
      const { scene, camera, character, obstacles, renderer } = window.__ebr42;
      const gl = renderer.getContext();
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const lights = [];
      scene.traverse((object) => {
        if (object.isLight) lights.push({ name: object.name, type: object.type, color: object.color.getHex(),
          intensity: object.intensity, distance: object.distance ?? null, decay: object.decay ?? null });
      });
      camera.updateMatrixWorld();
      const windowCenters = ['cottage-window-1', 'cottage-window-2', 'cottage-east-window'].map((name) => {
        const point = scene.getObjectByName(name).getWorldPosition(character.position.clone()).project(camera);
        return { name, x: (point.x + 1) * 640, y: (1 - point.y) * 360 };
      });
      const ghost = scene.getObjectByName('placement-ghost');
      return {
        character: character.position.toArray(), yaw: character.rotation.y,
        camera: camera.position.toArray(), cameraQuaternion: camera.quaternion.toArray(), cameraZoom: camera.zoom,
        phase: document.querySelector('[data-phase]')?.textContent, weather: window.getWeather(),
        pixel: window.getPixelRendering(), lights, obstacles, windowCenters,
        placementStatus: document.querySelector('.placement-status')?.textContent,
        ghost: ghost ? { visible: ghost.visible, position: ghost.position.toArray(), rotation: ghost.rotation.y } : null,
        webgl: gl.getParameter(gl.VERSION), renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
        time: window.__ebr42LastTime,
      };
    });
    assert.match(state.webgl, /WebGL 2\.0/);
    assert.match(state.renderer, /SwiftShader/i);
    assert.equal(state.pixel.enabled, true);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight], [320, 180]);
    const cdp = await context.newCDPSession(page);
    const screenshot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
    const image = await screenshot();
    let hidden;
    let noSmoke;
    let noFireflies;
    let effectState;
    let renderCalls;
    if (candidate) {
      effectState = await page.evaluate(() => {
        const { scene } = window.__ebr42;
        const flies = scene.getObjectByName('night-fireflies');
        const smoke = scene.getObjectByName('chimney-smoke');
        const opacity = Array.from(flies.geometry.getAttribute('instanceOpacity').array);
        return {
          activeFireflies: flies.visible ? opacity.filter((value) => value > 0).length : 0,
          fireflyOpacity: opacity, smokePuffs: smoke.children.filter((puff) => puff.visible).map((puff) => ({
            name: puff.name, position: puff.position.toArray(), size: puff.scale.x, opacity: puff.material.opacity,
          })),
        };
      });
      const setHidden = (smokeHidden, fliesHidden) => page.evaluate(({ smokeHidden, fliesHidden }) => {
        const { scene, composer, renderer } = window.__ebr42;
        scene.getObjectByName('chimney-smoke').visible = !smokeHidden;
        scene.getObjectByName('night-fireflies').material.visible = !fliesHidden;
        composer.render(0);
        return renderer.info.render.calls;
      }, { smokeHidden, fliesHidden });
      renderCalls = { both: await setHidden(false, false) };
      renderCalls.noSmoke = await setHidden(true, false);
      noSmoke = await screenshot();
      renderCalls.noFireflies = await setHidden(false, true);
      noFireflies = await screenshot();
      renderCalls.noEffects = await setHidden(true, true);
      hidden = await screenshot();
      await setHidden(false, false);
    }
    await cdp.detach();
    assert.deepEqual(errors, []);
    return { image, hidden, noSmoke, noFireflies, state, effectState, renderCalls, errors, faviconErrors };
  } finally { await context.close(); }
}

async function compare(page, before, after) {
  return page.evaluate(async ({ base, current, hidden, noSmoke, noFireflies, windowCenters }) => {
    const decode = async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    };
    const [a, b, off, withoutSmoke, withoutFlies] = await Promise.all([base, current, hidden, noSmoke, noFireflies].map(decode));
    const { width, height } = a;
    if (width !== 1280 || height !== 720 || [b, off, withoutSmoke, withoutFlies].some((image) => image.width !== width || image.height !== height)) {
      throw new Error('Gate frames must all be 1280x720');
    }
    const makeMask = () => new Uint8ClampedArray(width * height * 4);
    const raw = makeMask(); const smoke = makeMask(); const flies = makeMask(); const combined = makeMask();
    const stats = () => ({ changed: 0, bounds: null, maximum: [0, 0, 0], maximumLuminance: 0, sumLuminance: 0,
      voidBackground: 0, voidMaximumLuminance: 0, voidRgbSum: [0, 0, 0] });
    const smokeStats = stats(); const flyStats = stats();
    let rawChanged = 0; let hiddenChanged = 0; let unmasked = 0;
    const different = (x, y, i) => x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] ||
      x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3];
    function record(stats, x, y, i) {
      stats.changed++;
      if (!stats.bounds) stats.bounds = [x, y, x + 1, y + 1];
      else {
        stats.bounds[0] = Math.min(stats.bounds[0], x); stats.bounds[1] = Math.min(stats.bounds[1], y);
        stats.bounds[2] = Math.max(stats.bounds[2], x + 1); stats.bounds[3] = Math.max(stats.bounds[3], y + 1);
      }
      for (let c = 0; c < 3; c++) stats.maximum[c] = Math.max(stats.maximum[c], b.data[i + c]);
      const luminance = 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2];
      stats.sumLuminance += luminance;
      stats.maximumLuminance = Math.max(stats.maximumLuminance, luminance);
      if (a.data[i] === 16 && a.data[i + 1] === 20 && a.data[i + 2] === 22) {
        stats.voidBackground++;
        stats.voidMaximumLuminance = Math.max(stats.voidMaximumLuminance, luminance);
        for (let c = 0; c < 3; c++) stats.voidRgbSum[c] += b.data[i + c];
      }
    }
    for (let pixel = 0; pixel < width * height; pixel++) {
      const i = pixel * 4; const x = pixel % width; const y = Math.floor(pixel / width);
      const changed = different(a, b, i); const sm = different(b, withoutSmoke, i); const fl = different(b, withoutFlies, i);
      if (changed) { rawChanged++; raw[i] = 255; raw[i + 2] = 255; }
      if (different(a, off, i)) hiddenChanged++;
      if (changed && !sm && !fl) unmasked++;
      if (sm) { smoke[i] = smoke[i + 1] = smoke[i + 2] = 255; record(smokeStats, x, y, i); }
      if (fl) { flies[i] = flies[i + 1] = flies[i + 2] = 255; record(flyStats, x, y, i); }
      if (sm || fl) combined[i] = combined[i + 1] = combined[i + 2] = 255;
      raw[i + 3] = smoke[i + 3] = flies[i + 3] = combined[i + 3] = 255;
    }
    for (const item of [smokeStats, flyStats]) {
      item.meanLuminance = item.changed ? item.sumLuminance / item.changed : 0;
      item.voidMeanRgb = item.voidBackground ? item.voidRgbSum.map((value) => value / item.voidBackground) : null;
      delete item.sumLuminance;
      delete item.voidRgbSum;
    }
    const png = (data) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    };
    const windows = windowCenters.map(({ name, x, y }) => {
      const px = Math.max(0, Math.min(width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(height - 1, Math.round(y)));
      const i = (py * width + px) * 4;
      const rgb = Array.from(b.data.slice(i, i + 3));
      return { name, x: px, y: py, rgb, luminance: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] };
    });
    return { rawChanged, hiddenChanged, unmasked, smoke: smokeStats, fireflies: flyStats, windows,
      diffPng: png(raw), smokePng: png(smoke), firefliesPng: png(flies), combinedPng: png(combined) };
  }, { base: before.toString('base64'), current: after.image.toString('base64'), hidden: after.hidden.toString('base64'),
    noSmoke: after.noSmoke.toString('base64'), noFireflies: after.noFireflies.toString('base64'), windowCenters: after.state.windowCenters });
}

async function compareRetune(page, signed, current, oldSmoke, newSmoke, oldFlies, newFlies) {
  return page.evaluate(async ({ signed, current, oldSmoke, newSmoke, oldFlies, newFlies }) => {
    const decode = async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height);
    };
    const [a, b, oldMask, newMask, oldFly, newFly] = await Promise.all(
      [signed, current, oldSmoke, newSmoke, oldFlies, newFlies].map(decode),
    );
    const { width, height } = a;
    if (width !== 1280 || height !== 720 || [b, oldMask, newMask, oldFly, newFly].some((image) => image.width !== width || image.height !== height)) {
      throw new Error('Retune frames must all be 1280x720');
    }
    const diff = new Uint8ClampedArray(width * height * 4);
    const mask = new Uint8ClampedArray(width * height * 4);
    let changedPixels = 0; let outsideSmoke = 0; let fireflyMaskChanged = 0;
    let changedBounds = null;
    for (let p = 0; p < width * height; p++) {
      const i = p * 4; const x = p % width; const y = Math.floor(p / width);
      const changed = a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3];
      const allowed = oldMask.data[i] !== 0 || newMask.data[i] !== 0;
      if (changed) {
        changedPixels++; diff[i] = 255; diff[i + 2] = 255;
        if (!allowed) outsideSmoke++;
        if (!changedBounds) changedBounds = [x, y, x + 1, y + 1];
        else {
          changedBounds[0] = Math.min(changedBounds[0], x); changedBounds[1] = Math.min(changedBounds[1], y);
          changedBounds[2] = Math.max(changedBounds[2], x + 1); changedBounds[3] = Math.max(changedBounds[3], y + 1);
        }
      }
      if (oldFly.data[i] !== newFly.data[i] || oldFly.data[i + 1] !== newFly.data[i + 1] ||
        oldFly.data[i + 2] !== newFly.data[i + 2] || oldFly.data[i + 3] !== newFly.data[i + 3]) fireflyMaskChanged++;
      if (allowed) mask[i] = mask[i + 1] = mask[i + 2] = 255;
      diff[i + 3] = mask[i + 3] = 255;
    }
    const png = (data) => {
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(data, width, height), 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    };
    return { changedPixels, changedBounds, outsideSmoke, fireflyMaskChanged, diffPng: png(diff), maskPng: png(mask) };
  }, { signed: signed.toString('base64'), current: current.toString('base64'), oldSmoke: oldSmoke.toString('base64'),
    newSmoke: newSmoke.toString('base64'), oldFlies: oldFlies.toString('base64'), newFlies: newFlies.toString('base64') });
}

async function countMaskOutside(page, smokeMask, puffMasks) {
  return page.evaluate(async ({ smoke, puffs }) => {
    const decode = async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height);
    };
    const allowed = await decode(smoke);
    let outside = 0;
    for (const data of puffs) {
      const puff = await decode(data);
      if (puff.width !== allowed.width || puff.height !== allowed.height) throw new Error('Puff-mask size differs');
      for (let i = 0; i < puff.data.length; i += 4) {
        if (puff.data[i] !== 0 && allowed.data[i] === 0) outside++;
      }
    }
    return outside;
  }, { smoke: smokeMask.toString('base64'), puffs: puffMasks.map((mask) => mask.toString('base64')) });
}

async function makeRetuneCrops(page, signed, current, mask, oldBounds, newBounds) {
  return page.evaluate(async ({ signed, current, mask, oldBounds, newBounds }) => {
    const load = async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; };
    const [before, after, allowed] = await Promise.all([signed, current, mask].map(load));
    const boxes = [oldBounds, newBounds].filter(Boolean);
    if (!boxes.length) throw new Error('No smoke bounds for retune crop');
    const left = Math.max(0, Math.min(...boxes.map((box) => box[0])) - 48);
    const top = Math.max(0, Math.min(...boxes.map((box) => box[1])) - 48);
    const right = Math.min(1280, Math.max(...boxes.map((box) => box[2])) + 48);
    const bottom = Math.min(720, Math.max(...boxes.map((box) => box[3])) + 48);
    const rectangle = [left, top, right - left, bottom - top];
    const crop = (image) => {
      const canvas = document.createElement('canvas'); canvas.width = rectangle[2] * 3; canvas.height = rectangle[3] * 3;
      const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, ...rectangle, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1];
    };
    return { rectangle, images: { before: crop(before), after: crop(after), mask: crop(allowed) } };
  }, { signed: signed.toString('base64'), current: current.toString('base64'), mask, oldBounds, newBounds });
}

async function makeCrops(page, before, after, result) {
  return page.evaluate(async ({ base, current, flyMask, combinedMask, smokeBounds }) => {
    const load = async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; };
    const [a, b, fl, combined] = await Promise.all([base, current, flyMask, combinedMask].map(load));
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(fl, 0, 0);
    const mask = ctx.getImageData(0, 0, 1280, 720).data;
    // Count disconnected motes, then choose a 320x220 crop containing the most.
    const visited = new Uint8Array(1280 * 720); const components = [];
    for (let p = 0; p < visited.length; p++) {
      if (visited[p] || mask[p * 4] === 0) continue;
      const queue = [p]; visited[p] = 1; let sumX = 0; let sumY = 0;
      for (let head = 0; head < queue.length; head++) {
        const q = queue[head]; const x = q % 1280; const y = Math.floor(q / 1280); sumX += x; sumY += y;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx; const ny = y + dy; const n = ny * 1280 + nx;
          if (nx >= 0 && nx < 1280 && ny >= 0 && ny < 720 && !visited[n] && mask[n * 4] !== 0) { visited[n] = 1; queue.push(n); }
        }
      }
      if (queue.length >= 4) components.push([sumX / queue.length, sumY / queue.length]);
    }
    assertInBrowser(components.length > 0, 'no visible firefly components');
    let cluster; let best = -1;
    for (const [x, y] of components) {
      const left = Math.max(0, Math.min(960, Math.round(x - 160)));
      const top = Math.max(0, Math.min(500, Math.round(y - 110)));
      const count = components.filter(([cx, cy]) => cx >= left && cx < left + 320 && cy >= top && cy < top + 220).length;
      if (count > best) { best = count; cluster = [left, top, 320, 220]; }
    }
    assertInBrowser(best >= 2, `firefly crop has only ${best} components`);
    const [x0, y0, x1, y1] = smokeBounds;
    const left = Math.max(0, x0 - 48); const top = Math.max(0, y0 - 48);
    const chimney = [left, top, Math.min(1280, x1 + 48) - left, Math.min(720, y1 + 48) - top];
    const crop = (image, [x, y, width, height]) => {
      const c = document.createElement('canvas'); c.width = width * 3; c.height = height * 3;
      const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
      g.drawImage(image, x, y, width, height, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    };
    function assertInBrowser(condition, message) { if (!condition) throw new Error(message); }
    return { rectangles: { chimney, fireflyCluster: cluster, clusterComponents: best, enlargement: 3 }, images: {
      'chimney-before': crop(a, chimney), 'chimney-after': crop(b, chimney),
      'chimney-mask': crop(combined, chimney),
      'firefly-cluster-before': crop(a, cluster), 'firefly-cluster-after': crop(b, cluster),
      'firefly-cluster-mask': crop(combined, cluster),
    } };
  }, { base: before.toString('base64'), current: after.toString('base64'), combinedMask: result.combinedPng,
    flyMask: result.firefliesPng, smokeBounds: result.smoke.bounds });
}
