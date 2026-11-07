import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { approachStairsAcrossBridge } from '../../../tools/parity-bridge-route.mjs';
import { captureSourceSnapshot } from '../source-snapshot.mjs';

// Compare the actual QA baseline, not a regenerated or locally blessed image.
// Effects are hidden only for same-state isolation renders; full frames and
// their exact smoke/firefly masks are retained separately.
const baselineRoot = resolve(process.env.EBR42_QA_BASELINE || '/home/michael/OpenBot/Shared/qa-graphics-gate/gate-g-baseline-05d5b4a');
const evidenceRoot = resolve(process.env.EBR42_EVIDENCE_ROOT || 'evidence/EBR-42');
const output = resolve(process.env.EBR42_QA_OUT || join(evidenceRoot, 'merge-05d5b4a/qa-gate'));
assert.ok(output !== baselineRoot && !output.startsWith(`${baselineRoot}/`), 'Do not write inside the shared QA baseline');
const candidateUrl = (process.env.EBR42_URL || 'http://127.0.0.1:5222').replace(/\/$/, '');
const main = '05d5b4aa566bf3d48cd2d1f5b94224224287c4c2';
const retuned = '114e2afa2cedfabc82c9d438eb27a3dfb8825232';
const seed = 0xeb730001;
const viewport = { width: 1280, height: 720 };
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
const snapshot = captureSourceSnapshot();
execFileSync('git', ['diff', '--cached', '--quiet', retuned, '--', 'src/effects']);
execFileSync('git', ['diff', '--cached', '--quiet', main, '--', 'src/character/createCharacter.ts']);
execFileSync('git', ['diff', '--cached', '--quiet', main, '--',
  'src/lighting/dayNightPhases.ts', 'src/lighting/createPracticalLights.ts',
  'src/lighting/createSunsetWaterTint.ts', 'src/weather/createRainEffect.ts', 'src/weather/rainSettings.ts',
  'src/weather/cloudySettings.ts', 'src/scene', 'src/ui', 'src/postprocess', 'src/style.css']);
const baselineBytes = await readFile(join(baselineRoot, 'baseline.json'));
const baseline = JSON.parse(baselineBytes);
const sumsBytes = await readFile(join(baselineRoot, 'SHA256SUMS.txt'));
const sums = new Map(sumsBytes.toString('utf8').trim().split('\n').map((line) => {
  const match = line.match(/^([\da-f]{64})\s+(.+\.png)$/);
  if (!match) throw new Error(`Invalid baseline checksum line: ${line}`);
  return [match[2], match[1]];
}));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value) => value === undefined ? null : JSON.parse(JSON.stringify(value));
assert.equal(baseline.sourceSha, main);
assert.deepEqual(baseline.viewport, viewport);
assert.equal(baseline.deviceScaleFactor, 1);
assert.equal(baseline.seed, seed);
assert.deepEqual(baseline.scenarios, scenarios);
assert.equal(sums.size, scenarios.length);
for (const directory of ['baseline', 'candidate', 'no-smoke', 'no-fireflies', 'no-effects', 'diff', 'mask/smoke', 'mask/fireflies', 'mask/combined']) {
  await mkdir(join(output, directory), { recursive: true });
}
await writeFile(join(output, 'baseline.json'), baselineBytes);
await writeFile(join(output, 'SHA256SUMS.txt'), sumsBytes);

const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
try {
  assert.equal(browser.version(), baseline.browser, 'Use the QA baseline Chromium version');
  const comparePage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const report = { main, baselineRoot, candidateUrl, sourceSnapshot: snapshot,
    browser: browser.version(), viewport, deviceScaleFactor: 1, seed,
    method: 'The QA baseline used a seeded weather hook; the candidate uses its visual seed with the same LCG. Hook call counts are instrumentation-specific; weather state and effect-hidden pixels are compared.',
    frames: {}, failures: [] };
  for (const scenario of baseline.scenarios) {
    const original = await readFile(join(baselineRoot, 'baseline', `${scenario.name}.png`));
    const baselineHash = sha256(original);
    assert.equal(baselineHash, baseline.frames[scenario.name].sha256, `${scenario.name}: baseline metadata hash differs`);
    assert.equal(baselineHash, sums.get(`${scenario.name}.png`), `${scenario.name}: baseline checksum differs`);
    const candidate = await capture(scenario);
    const stateKeys = ['position', 'yaw', 'camera', 'cameraQuaternion', 'cameraZoom', 'pixel', 'weather', 'phase', 'buildings'];
    const stateMismatches = stateKeys.filter((key) => !isDeepStrictEqual(canonical(candidate.state[key]), canonical(baseline.frames[scenario.name][key])));
    const metrics = await compare(comparePage, original, candidate);
    if (stateMismatches.length) report.failures.push(`${scenario.name}: state differs (${stateMismatches.join(', ')})`);
    if (metrics.outsideAllowed) report.failures.push(`${scenario.name}: ${metrics.outsideAllowed} pixels outside the effect mask`);
    if (metrics.hiddenChanged) report.failures.push(`${scenario.name}: ${metrics.hiddenChanged} pixels differ with both effects hidden`);
    const expectedFlies = scenario.search.includes('phase=night') ? 14 : 0;
    if (candidate.effects.activeFireflies !== expectedFlies) report.failures.push(`${scenario.name}: unexpected firefly count`);
    if (candidate.effects.smokePuffs < 1 || candidate.effects.smokePuffs > 6) report.failures.push(`${scenario.name}: unexpected smoke count`);
    if (candidate.errors.length) report.failures.push(`${scenario.name}: application errors: ${candidate.errors.join('; ')}`);
    for (const [directory, data] of Object.entries({
      baseline: original, candidate: candidate.image, 'no-smoke': candidate.noSmoke,
      'no-fireflies': candidate.noFlies, 'no-effects': candidate.hidden,
      diff: Buffer.from(metrics.diffPng, 'base64'), 'mask/smoke': Buffer.from(metrics.smokePng, 'base64'),
      'mask/fireflies': Buffer.from(metrics.flyPng, 'base64'), 'mask/combined': Buffer.from(metrics.combinedPng, 'base64'),
    })) await writeFile(join(output, directory, `${scenario.name}.png`), data);
    const { diffPng, smokePng, flyPng, combinedPng, ...counts } = metrics;
    report.frames[scenario.name] = { ...counts, stateMismatches, state: candidate.state, effects: candidate.effects,
      baselineSha256: baselineHash, candidateSha256: sha256(candidate.image), errors: candidate.errors };
    console.log(`${scenario.name}: ${metrics.changedPixels} changed; smoke ${metrics.smoke.changed}, fireflies ${metrics.fireflies.changed}, ` +
      `${metrics.outsideAllowed} outside mask, ${metrics.hiddenChanged} with effects hidden`);
  }
  await writeFile(join(output, 'parity.json'), `${JSON.stringify(report, null, 2)}\n`);
  await comparePage.close();
  assert.deepEqual(report.failures, [], 'QA baseline effect-mask parity failed');
  console.log(`QA Gate G PASS: ${scenarios.length} frames against ${main}, zero outside effect masks and zero with effects hidden`);
} finally { await browser.close(); }

async function capture(scenario) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  try {
    await page.addInitScript(({ seed }) => {
      let random = seed >>> 0;
      window.__gateRandom = () => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random / 0x100000000;
      };
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__gateTime = 0;
      window.__gateStep = (time) => {
        window.__gateTime = time;
        const current = [...callbacks.values()];
        callbacks.clear();
        if (!current.length) throw new Error('No animation frame scheduled');
        for (const callback of current) callback(time);
      };
    }, { seed });
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
      const patched = body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__gateRandom,');
      await route.fulfill({ response, body: `${patched}\nwindow.__gate = { scene, camera, character, controls, follow, stairs, renderer, composer, placement, visualSeed };\n` });
    });
    await page.goto(`${candidateUrl}/${scenario.search}&seed=${seed}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__gate));
    assert.equal(await page.evaluate(() => window.__gate.visualSeed), seed);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__gateStep(0));
    if (scenario.setup === 'stairs') {
      await approachStairsAcrossBridge(page, '__gate', '__gateStep');
      const distance = await page.evaluate(() => {
        const { character, stairs } = window.__gate;
        return Math.hypot(character.position.x - stairs.footPad.position.x, character.position.z - stairs.footPad.position.z);
      });
      assert.ok(distance < 0.03, `Click-walk did not reach stairs pad: ${distance}`);
    } else if (scenario.setup === 'placement') {
      await page.keyboard.press('f');
      await page.mouse.move(449, 381);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      await page.evaluate(() => window.__gateStep(100));
      assert.equal(await page.evaluate(() => window.__gate.scene.getObjectByName('placement-ghost')?.visible), true);
    } else if (scenario.setup === 'walk') {
      await page.keyboard.down('s');
      await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__gateStep(i * 100); });
      await page.keyboard.up('s');
    } else if (scenario.setup === 'rain') {
      await page.evaluate(() => { for (let i = 1; i <= 25; i++) window.__gateStep(i * 100); });
      assert.equal(await page.evaluate(() => window.getWeather().rainAmount), 1);
    } else if (scenario.setup === 'buildings') {
      await page.evaluate(() => {
        const { camera, character, follow, composer } = window.__gate;
        follow(character.position.clone().set(-1.45, 2.4, -3.4));
        camera.zoom = 1.8;
        camera.updateProjectionMatrix();
        composer.render(0);
      });
    }
    const state = await page.evaluate((inspectBuildings) => {
      const { scene, camera, character } = window.__gate;
      const gl = document.querySelector('#scene').getContext('webgl2');
      const debug = gl?.getExtension('WEBGL_debug_renderer_info');
      let buildings;
      if (inspectBuildings) {
        scene.updateMatrixWorld(true);
        const centers = ['farm-cottage', 'farm-ramp-coop-1', 'farm-ramp-coop-2'].map((name) => {
          const building = scene.getObjectByName(name);
          const point = building.getWorldPosition(character.position.clone());
          point.y += 0.8;
          point.project(camera);
          return { name, visible: building.visible, x: point.x, y: point.y };
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
        renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), phase: document.querySelector('[data-phase]')?.textContent,
        time: window.__gateTime };
    }, scenario.setup === 'buildings');
    assert.match(state.webgl, /WebGL 2\.0/);
    assert.match(state.renderer, /SwiftShader/i);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight, state.pixel.devicePixelRatio], [320, 180, 1]);
    const effects = await page.evaluate(() => {
      const { scene } = window.__gate;
      const smoke = scene.getObjectByName('chimney-smoke');
      const flies = scene.getObjectByName('night-fireflies');
      const opacity = Array.from(flies.geometry.getAttribute('instanceOpacity').array);
      return { smokePuffs: smoke.children.filter((puff) => puff.visible).length,
        activeFireflies: flies.visible ? opacity.filter((value) => value > 0).length : 0, fireflyOpacity: opacity };
    });
    const cdp = await context.newCDPSession(page);
    const screenshot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
    const image = await screenshot();
    const setHidden = (smokeHidden, flyHidden) => page.evaluate(({ smokeHidden, flyHidden }) => {
      const { scene, composer } = window.__gate;
      scene.getObjectByName('chimney-smoke').visible = !smokeHidden;
      scene.getObjectByName('night-fireflies').material.visible = !flyHidden;
      composer.render(0);
    }, { smokeHidden, flyHidden });
    await setHidden(true, false);
    const noSmoke = await screenshot();
    await setHidden(false, true);
    const noFlies = await screenshot();
    await setHidden(true, true);
    const hidden = await screenshot();
    await setHidden(false, false);
    await cdp.detach();
    return { image, noSmoke, noFlies, hidden, state, effects, errors };
  } finally { await context.close(); }
}

async function compare(page, baseline, candidate) {
  return page.evaluate(async ({ baseline, full, noSmoke, noFlies, hidden }) => {
    async function decode(data) {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    }
    const [a, b, s, f, h] = await Promise.all([baseline, full, noSmoke, noFlies, hidden].map(decode));
    if ([a, b, s, f, h].some((image) => image.width !== 1280 || image.height !== 720)) throw new Error('QA frames must be 1280×720');
    const size = 1280 * 720 * 4;
    const diff = new Uint8ClampedArray(size); const smoke = new Uint8ClampedArray(size);
    const flies = new Uint8ClampedArray(size); const combined = new Uint8ClampedArray(size);
    const stats = () => ({ changed: 0, bounds: null, peakLuminance: 0 });
    const smokeStats = stats(); const flyStats = stats();
    const differs = (x, y, i) => x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] ||
      x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3];
    function record(item, x, y, i) {
      item.changed++;
      if (!item.bounds) item.bounds = [x, y, x + 1, y + 1];
      else {
        item.bounds[0] = Math.min(item.bounds[0], x); item.bounds[1] = Math.min(item.bounds[1], y);
        item.bounds[2] = Math.max(item.bounds[2], x + 1); item.bounds[3] = Math.max(item.bounds[3], y + 1);
      }
      item.peakLuminance = Math.max(item.peakLuminance, 0.2126 * b.data[i] + 0.7152 * b.data[i + 1] + 0.0722 * b.data[i + 2]);
    }
    let changedPixels = 0; let outsideAllowed = 0; let hiddenChanged = 0; let interactionPixels = 0;
    for (let p = 0; p < 1280 * 720; p++) {
      const i = p * 4; const x = p % 1280; const y = Math.floor(p / 1280);
      const changed = differs(a, b, i); const sm = differs(b, s, i); const fly = differs(b, f, i);
      // Include any quantized interaction visible only when both effects hide.
      const interaction = differs(b, h, i) && !sm && !fly;
      if (changed) { changedPixels++; diff[i] = 255; diff[i + 2] = 255; }
      if (interaction) interactionPixels++;
      if (changed && !sm && !fly && !interaction) outsideAllowed++;
      if (differs(a, h, i)) hiddenChanged++;
      if (sm) { smoke[i] = smoke[i + 1] = smoke[i + 2] = 255; record(smokeStats, x, y, i); }
      if (fly) { flies[i] = flies[i + 1] = flies[i + 2] = 255; record(flyStats, x, y, i); }
      if (sm || fly || interaction) combined[i] = combined[i + 1] = combined[i + 2] = 255;
      diff[i + 3] = smoke[i + 3] = flies[i + 3] = combined[i + 3] = 255;
    }
    const png = (data) => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      canvas.getContext('2d').putImageData(new ImageData(data, 1280, 720), 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    };
    return { changedPixels, outsideAllowed, hiddenChanged, interactionPixels, smoke: smokeStats, fireflies: flyStats,
      diffPng: png(diff), smokePng: png(smoke), flyPng: png(flies), combinedPng: png(combined) };
  }, { baseline: baseline.toString('base64'), full: candidate.image.toString('base64'),
    noSmoke: candidate.noSmoke.toString('base64'), noFlies: candidate.noFlies.toString('base64'), hidden: candidate.hidden.toString('base64') });
}
