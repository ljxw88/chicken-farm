import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { approachStairsAcrossBridge } from './parity-bridge-route.mjs';

// Compare archived clean EBR-75 main or the exact pre-merge EBR-70 head,
// without checking out or modifying either branch. The older sheep-only mode
// remains available for reproducing the Look Dev revision evidence.
const mainSha = '6daf042ad85882f020268baf53fc92fb09e921ad';
const acceptedPenSha = '8ce0cbe19d7c63e5c2608b28725ccb8e9b4700aa';
const previousHeadSha = '76a2181a2bc90b793b7dc58e21cc062d17d13dd6';
const sheepDelta = process.env.EBR70_SHEEP_DELTA === '1';
const previousHead = process.env.EBR70_PREVIOUS_HEAD === '1';
assert.ok(!(sheepDelta && previousHead), 'Select only one comparison mode');
const baseSha = previousHead ? previousHeadSha : sheepDelta ? acceptedPenSha : mainSha;
const candidateUrl = (process.env.EBR70_URL || 'http://100.88.150.21:5213').replace(/\/$/, '');
const output = resolve(process.env.EBR70_GATE_DIR || `evidence/EBR-70/${previousHead ? 'merge-previous' : 'merge-main'}`);
const maskDirectory = resolve(process.env.EBR70_MASK_DIR || join(output, 'mask'));
const viewport = { width: 1280, height: 720 };
const visualSeed = 123;
const rainSeed = 0xeb730001;
const scenarios = [
  { name: 'spawn-day', phase: 'daytime', weather: 'clear', setup: 'spawn' },
  { name: 'spawn-sunset', phase: 'sunset', weather: 'clear', setup: 'spawn' },
  { name: 'spawn-night', phase: 'night', weather: 'clear', setup: 'spawn' },
  { name: 'spawn-cloudy', phase: 'daytime', weather: 'cloudy', setup: 'weather' },
  { name: 'spawn-rain', phase: 'daytime', weather: 'rain', setup: 'weather' },
  { name: 'walk-day', phase: 'daytime', weather: 'clear', setup: 'walk' },
  { name: 'stairs-pad', phase: 'daytime', weather: 'clear', setup: 'stairs' },
  { name: 'placement-ghost', phase: 'daytime', weather: 'clear', setup: 'placement' },
  { name: 'placement-rejected', phase: 'daytime', weather: 'clear', setup: 'placement-rejected' },
  { name: 'cottage-coops-day', phase: 'daytime', weather: 'clear', setup: 'buildings' },
  { name: 'cottage-coops-night', phase: 'night', weather: 'clear', setup: 'buildings' },
  { name: 'pen-day', phase: 'daytime', weather: 'clear', setup: 'pen' },
  { name: 'pen-sunset', phase: 'sunset', weather: 'clear', setup: 'pen' },
  { name: 'pen-night', phase: 'night', weather: 'clear', setup: 'pen' },
  { name: 'cycle-sunset-to-night', phase: 'sunset', weather: 'clear', setup: 'cycle' },
  { name: 'night-rain-half', phase: 'night', weather: 'clear', setup: 'rain-half' },
  { name: 'night-rain-to-cloud', phase: 'night', weather: 'clear', setup: 'rain-to-cloud' },
];
const only = process.env.EBR70_GATE_ONLY?.split(',');
const selected = only ? scenarios.filter(({ name }) => only.includes(name)) : scenarios;
assert.ok(selected.length > 0, 'No Gate G scenarios selected');

let temp;
let server;
let browser;
try {
  assert.equal(execFileSync('git', ['rev-parse', `${baseSha}^{commit}`], { encoding: 'utf8' }).trim(), baseSha);
  try {
    temp = await mkdtemp('/tmp/opencode/ebr70-baseline-');
  } catch (error) {
    if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
    temp = await mkdtemp(join(tmpdir(), 'ebr70-baseline-'));
  }
  const root = join(temp, 'archive');
  await mkdir(root);
  const archive = join(temp, 'main.tar');
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, baseSha, 'index.html', 'package.json', 'package-lock.json', 'src']);
  execFileSync('tar', ['-xf', archive, '-C', root]);
  const tree = execFileSync('git', ['ls-tree', '-r', baseSha, '--', 'src', 'index.html', 'package.json', 'package-lock.json'],
    { encoding: 'utf8' }).trim();
  for (const entry of tree.split('\n')) {
    const match = /^100644 blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
    assert.ok(match, `Unexpected baseline tree entry: ${entry}`);
    const bytes = await readFile(join(root, match[2]));
    const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    assert.equal(blob, match[1], `Archived baseline differs: ${match[2]}`);
  }
  await symlink(resolve('node_modules'), join(root, 'node_modules'), 'dir');
  server = await createServer({ root, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const baselineUrl = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
  for (const directory of ['baseline', 'candidate', 'diff', 'crops', 'hidden-fold', 'hidden-feature']) {
    await mkdir(join(output, directory), { recursive: true });
  }
  await mkdir(maskDirectory, { recursive: true });
  const comparePage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const results = {};
  let failures = 0;

  for (const scenario of selected) {
    const baseline = await capture(browser, baselineUrl, scenario, false);
    const candidate = await capture(browser, candidateUrl, scenario, true);
    const name = scenario.name;
    await writeFile(join(output, 'baseline', `${name}.png`), baseline.png);
    await writeFile(join(output, 'candidate', `${name}.png`), candidate.png);
    if (candidate.hiddenFold) await writeFile(join(output, 'hidden-fold', `${name}.png`), candidate.hiddenFold);
    if (candidate.hidden && !candidate.hidden.equals(candidate.hiddenFold)) {
      await writeFile(join(output, 'hidden-feature', `${name}.png`), candidate.hidden);
    }
    const diff = await comparePage.evaluate(async ({ baseline, baselineHidden, candidate, hiddenFold, hidden, hudRects, sheepDelta }) => {
      async function pixels(data) {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      const [original, originalHidden, visible, withoutFold, withoutFeature] = await Promise.all([
        pixels(baseline), pixels(baselineHidden), pixels(candidate), pixels(hiddenFold), pixels(hidden),
      ]);
      if (original.width !== 1280 || original.height !== 720 || visible.width !== 1280 || visible.height !== 720) {
        throw new Error('Unexpected frame dimensions');
      }
      const maskCanvas = document.createElement('canvas');
      const diffCanvas = document.createElement('canvas');
      const feedbackCanvas = document.createElement('canvas');
      maskCanvas.width = diffCanvas.width = feedbackCanvas.width = 1280;
      maskCanvas.height = diffCanvas.height = feedbackCanvas.height = 720;
      const maskCtx = maskCanvas.getContext('2d');
      const diffCtx = diffCanvas.getContext('2d');
      const feedbackCtx = feedbackCanvas.getContext('2d');
      const mask = maskCtx.createImageData(1280, 720);
      const diff = diffCtx.createImageData(1280, 720);
      const feedback = feedbackCtx.createImageData(1280, 720);
      let changed = 0;
      let masked = 0;
      let foldPixels = 0;
      let feedbackPixels = 0;
      let outside = 0;
      let hiddenMismatch = 0;
      const hudChanged = { biome: 0, placement: 0 };
      let minX = 1280; let minY = 720; let maxX = -1; let maxY = -1;
      const differs = (a, b, i) => a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
      for (let i = 0; i < original.data.length; i += 4) {
        const inFold = differs(visible.data, withoutFold.data, i) ||
          (sheepDelta && differs(original.data, originalHidden.data, i));
        const inFeedback = differs(withoutFold.data, withoutFeature.data, i);
        const inMask = inFold || inFeedback;
        const isChanged = differs(original.data, visible.data, i);
        if (differs(sheepDelta ? originalHidden.data : original.data, withoutFeature.data, i)) hiddenMismatch++;
        if (inFold) foldPixels++;
        if (inFeedback) {
          feedbackPixels++;
          feedback.data[i] = feedback.data[i + 1] = feedback.data[i + 2] = 255;
        }
        if (inMask) {
          masked++;
          const pixel = i / 4;
          const x = pixel % 1280;
          const y = Math.floor(pixel / 1280);
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = 255;
        }
        if (isChanged) {
          changed++;
          if (!inMask) outside++;
          const pixel = i / 4;
          const x = pixel % 1280;
          const y = Math.floor(pixel / 1280);
          for (const [name, rect] of Object.entries(hudRects)) {
            if (rect && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) hudChanged[name]++;
          }
          diff.data[i] = 255;
          diff.data[i + 2] = 255;
        }
        mask.data[i + 3] = diff.data[i + 3] = feedback.data[i + 3] = 255;
      }
      maskCtx.putImageData(mask, 0, 0);
      diffCtx.putImageData(diff, 0, 0);
      feedbackCtx.putImageData(feedback, 0, 0);
      return { changed, masked, foldPixels, feedbackPixels, outside, hiddenMismatch, hudChanged,
        bounds: masked ? [minX, minY, maxX, maxY] : null,
        mask: maskCanvas.toDataURL('image/png').split(',')[1], diff: diffCanvas.toDataURL('image/png').split(',')[1],
        feedback: feedbackCanvas.toDataURL('image/png').split(',')[1] };
    }, { baseline: baseline.png.toString('base64'), baselineHidden: (baseline.hiddenFold || baseline.png).toString('base64'),
      candidate: candidate.png.toString('base64'), hiddenFold: (candidate.hiddenFold || candidate.png).toString('base64'),
      hidden: (candidate.hidden || candidate.png).toString('base64'), hudRects: candidate.hudRects, sheepDelta });
    await writeFile(join(maskDirectory, `${name}.png`), Buffer.from(diff.mask, 'base64'));
    await writeFile(join(output, 'diff', `${name}.png`), Buffer.from(diff.diff, 'base64'));
    if (diff.feedbackPixels) await writeFile(join(maskDirectory, `${name}-feedback.png`), Buffer.from(diff.feedback, 'base64'));
    const { mask, diff: diffPng, feedback, ...counts } = diff;
    void mask; void diffPng; void feedback;
    const stateMatches = isDeepStrictEqual(baseline.state, candidate.state);
    results[name] = { ...counts, stateMatches, placementStatus: candidate.placementStatus &&
      { baseline: baseline.placementStatus, candidate: candidate.placementStatus }, baseline: baseline.state, candidate: candidate.state,
      cropped: candidate.cropBounds };
    if (!stateMatches || counts.outside || counts.hiddenMismatch || (previousHead && counts.changed)) failures++;
    if (candidate.crops) {
      for (const [kind, data] of Object.entries(candidate.crops)) {
        await writeFile(join(output, 'crops', `${name}-${kind}.png`), Buffer.from(data, 'base64'));
      }
    }
    if (candidate.geometry) await writeFile(join(output, 'geometry.json'), `${JSON.stringify(candidate.geometry, null, 2)}\n`);
    console.log(`${name}: changed=${counts.changed} mask=${counts.masked} outside=${counts.outside} referenceMismatch=${counts.hiddenMismatch} state=${stateMatches}`);
  }
  await comparePage.close();
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceStatus = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', 'src', 'index.html',
    'package.json', 'package-lock.json', 'tests', 'tools/ebr70-evidence.mjs', 'tools/character-parity.mjs',
    'tools/lighting-probe.mjs', 'tools/placement-environment-replay.mjs'], { encoding: 'utf8' }).trim();
  const report = { baseSha, baselineVerification: 'Git archive source and lockfile verified against every Git tree blob',
    scope: previousHead ? 'full-frame-no-changes' : sheepDelta ? 'sheep-only' : 'new-fold-and-placement', maskDirectory,
    sourceSha, sourceStatus, candidateUrl, chromium: browser.version(), viewport,
    deviceScaleFactor: 1, visualSeed, rainSeed, scenarios: selected.map(({ name }) => name),
    complete: selected.length === scenarios.length, results, failures };
  await writeFile(join(output, 'gate-g.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert.equal(failures, 0, `Gate G failed in ${failures} frames; see gate-g.json`);
} finally {
  await browser?.close();
  await server?.close();
  if (temp) await rm(temp, { recursive: true });
}

async function capture(browser, url, scenario, candidate) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    await page.addInitScript(({ seed }) => {
      let random = seed >>> 0;
      window.__ebr70RandomCalls = 0;
      window.__ebr70Random = () => {
        window.__ebr70RandomCalls++;
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return random / 0x100000000;
      };
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__ebr70Step = (time) => {
        const current = [...callbacks.values()];
        callbacks.clear();
        if (!current.length) throw new Error('No animation frame scheduled');
        for (const callback of current) callback(time);
      };
    }, { seed: rainSeed });
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
      await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr70Random,')}
window.__ebr70Gate = { scene, camera, character, controls, follow, stairs, obstacles, renderer, composer, placement };
` });
    });
    await page.goto(`${url}/?phase=${scenario.phase}&weather=${scenario.weather}&seed=${visualSeed}`, { waitUntil: 'networkidle' });
    assert.ok(await page.evaluate(() => Boolean(window.__ebr70Gate)));
    assert.ok(await page.evaluate(() => window.__ebr70RandomCalls > 0));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.__ebr70Step(0));

    if (scenario.setup === 'stairs') {
      await approachStairsAcrossBridge(page, '__ebr70Gate', '__ebr70Step');
      const distance = await page.evaluate(() => {
        const { character, stairs } = window.__ebr70Gate;
        return Math.hypot(character.position.x - stairs.footPad.position.x, character.position.z - stairs.footPad.position.z);
      });
      assert.ok(distance < 0.03, `stairs-pad approach missed: ${distance}`);
    } else if (scenario.setup === 'placement' || scenario.setup === 'placement-rejected') {
      await page.keyboard.press('f');
      // The old parity point (449,381) is inside the new reserved footprint;
      // this clear tile exercises the same valid-ghost behavior on both builds.
      await page.mouse.move(449, scenario.setup === 'placement' ? 340 : 381);
      assert.match(await page.locator('.placement-status').textContent(),
        scenario.setup === 'placement-rejected' && (candidate || sheepDelta || previousHead) ? /Blocked by a farm object/ : /Ready to place/);
      await page.evaluate(() => window.__ebr70Step(100));
    } else if (scenario.setup === 'walk') {
      await page.keyboard.down('s');
      await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__ebr70Step(i * 100); });
      await page.keyboard.up('s');
    } else if (scenario.setup === 'weather') {
      await page.evaluate(() => { for (let i = 1; i <= 25; i++) window.__ebr70Step(i * 100); });
      const weather = await page.evaluate(() => window.getWeather());
      assert.equal(weather.mode, scenario.weather);
      assert.equal(scenario.weather === 'rain' ? weather.rainAmount : weather.cloudyAmount, 1);
    } else if (scenario.setup === 'cycle') {
      await page.evaluate(() => {
        window.setDayNightCycleSeconds(72);
        for (let time = 500; time <= 9000; time += 500) window.__ebr70Step(time);
      });
    } else if (scenario.setup === 'rain-half' || scenario.setup === 'rain-to-cloud') {
      await page.evaluate((setup) => {
        window.setWeather('rain');
        if (setup === 'rain-half') window.__ebr70Step(875);
        else {
          window.__ebr70Step(1750);
          window.setWeather('cloudy');
          window.__ebr70Step(2625);
        }
      }, scenario.setup);
      const weather = await page.evaluate(() => window.getWeather());
      assert.equal(weather.rainAmount, 0.5);
      assert.equal(weather.cloudyAmount, scenario.setup === 'rain-half' ? 0 : 0.5);
    } else if (scenario.setup === 'buildings' || scenario.setup === 'pen') {
      await page.evaluate((setup) => {
        const { camera, character, follow, composer } = window.__ebr70Gate;
        if (setup === 'pen') {
          follow(character.position.clone().set(-4.7, 2.4, 4.5));
          camera.zoom = 1.8;
        } else {
          follow(character.position.clone().set(-1.45, 2.4, -3.4));
          camera.zoom = 1.8;
        }
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        composer.render(0);
      }, scenario.setup);
    }
    const state = await page.evaluate((compareSheep) => {
      const { scene, camera, character } = window.__ebr70Gate;
      const gl = document.querySelector('#scene').getContext('webgl2');
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const light = (name) => {
        const item = scene.getObjectByName(name);
        return { color: item.color.toArray(), groundColor: item.groundColor?.toArray(),
          intensity: item.intensity, position: item.position.toArray() };
      };
      const fold = compareSheep ? [1, 2].map((index) => {
        const animal = scene.getObjectByName(`sheep-${index}`);
        const head = scene.getObjectByName(`sheep-${index}-head-pivot`);
        const shadow = scene.getObjectByName(`sheep-${index}-shadow`);
        if (!animal || !head || !shadow) throw new Error(`Missing sheep ${index}`);
        return { position: animal.position.toArray(), yaw: animal.rotation.y, headAngle: head.rotation.x,
          shadow: { position: shadow.position.toArray(), rotation: shadow.rotation.z,
            scale: shadow.scale.toArray(), opacity: shadow.material.opacity } };
      }) : undefined;
      return { position: character.position.toArray(), yaw: character.rotation.y, camera: camera.position.toArray(),
        cameraQuaternion: camera.quaternion.toArray(), cameraZoom: camera.zoom, pixel: window.getPixelRendering(),
        weather: window.getWeather(), phase: document.querySelector('[data-phase]')?.textContent,
        light: { ambient: light('day-night-ambient'), hemisphere: light('day-night-hemisphere'),
          directional: light('day-night-directional'), fog: { color: scene.fog.color.toArray(), density: scene.fog.density },
          practical: ['window-light-1', 'window-light-2', 'lantern-light'].map((name) => scene.getObjectByName(name).intensity),
          accents: ['cottage-window-1', 'cottage-window-2', 'cottage-east-window', 'ramp-coop-1-pop-hole-glow', 'ramp-coop-2-pop-hole-glow']
            .map((name) => scene.getObjectByName(name).material.emissiveIntensity) },
        fold, randomCalls: window.__ebr70RandomCalls, renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) };
    }, previousHead);
    assert.match(state.renderer, /SwiftShader/i);
    assert.equal(state.pixel.enabled, true);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight], [320, 180]);
    const hudRects = await page.evaluate(() => Object.fromEntries([
      ['biome', '.farm-biome'], ['placement', '.placement-controls'],
    ].map(([name, selector]) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return [name, rect && { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }];
    })));
    const cdp = await context.newCDPSession(page);
    async function screenshot() {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const bytes = Buffer.from(shot.data, 'base64');
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1280, 720]);
      return bytes;
    }
    const png = await screenshot();
    const placementStatus = scenario.setup.startsWith('placement') ? await page.locator('.placement-status').textContent() : undefined;
    let crops;
    let cropBounds;
    let geometry;
    let hidden;
    let hiddenFold;
    if (candidate || sheepDelta) {
      if (candidate && scenario.setup === 'pen') {
        const cropResult = await page.evaluate(async (png) => {
          const THREE = await import('/node_modules/three/build/three.module.js');
          const { scene, camera } = window.__ebr70Gate;
          scene.updateMatrixWorld(true);
          function rectangle(object, pad) {
            const box = new THREE.Box3().setFromObject(object);
            const points = [];
            for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
              const point = new THREE.Vector3(x, y, z).project(camera);
              points.push([(point.x + 1) * 640, (1 - point.y) * 360]);
            }
            const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point[0])) - pad));
            const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point[1])) - pad));
            const right = Math.min(1280, Math.ceil(Math.max(...points.map((point) => point[0])) + pad));
            const bottom = Math.min(720, Math.ceil(Math.max(...points.map((point) => point[1])) + pad));
            return [left, top, right - left, bottom - top];
          }
          const image = new Image();
          image.src = `data:image/png;base64,${png}`;
          await image.decode();
          function crop(rect, scale) {
            const [x, y, width, height] = rect;
            const canvas = document.createElement('canvas');
            canvas.width = width * scale;
            canvas.height = height * scale;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(image, x, y, width, height, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png').split(',')[1];
          }
          const pen = rectangle(scene.getObjectByName('farm-sheepfold'), 10);
          // The western sheep is visible through the front opening; include
          // the second as well, even though its nearer fence occludes part of it.
          const sheep = rectangle(scene.getObjectByName('sheep-1'), 10);
          const otherSheep = rectangle(scene.getObjectByName('sheep-2'), 10);
          return { bounds: { pen: [...pen, 3], sheep: [...sheep, 4], otherSheep: [...otherSheep, 4] },
            images: { 'pen-3x': crop(pen, 3), 'sheep-4x': crop(sheep, 4), 'sheep-2-4x': crop(otherSheep, 4) } };
        }, png.toString('base64'));
        cropBounds = cropResult.bounds;
        crops = cropResult.images;
        if (scenario.name === 'pen-day') geometry = await page.evaluate(async () => {
          const THREE = await import('/node_modules/three/build/three.module.js');
          const { scene, obstacles } = window.__ebr70Gate;
          scene.updateMatrixWorld(true);
          const size = (box) => box.getSize(new THREE.Vector3()).toArray();
          const fences = obstacles.filter((item) => item.name.startsWith('sheepfold-fence-'));
          const extents = { minX: Math.min(...fences.map((item) => item.minX)), maxX: Math.max(...fences.map((item) => item.maxX)),
            minZ: Math.min(...fences.map((item) => item.minZ)), maxZ: Math.max(...fences.map((item) => item.maxZ)) };
          const fenceVisual = fences.reduce((box, item) =>
            box.union(new THREE.Box3().setFromObject(scene.getObjectByName(item.name))), new THREE.Box3());
          const distance = (item) => {
            if (item.kind === 'circle') return Math.hypot(Math.max(extents.minX - item.x, 0, item.x - extents.maxX),
              Math.max(extents.minZ - item.z, 0, item.z - extents.maxZ)) - item.radius;
            return Math.hypot(Math.max(extents.minX - item.maxX, 0, item.minX - extents.maxX),
              Math.max(extents.minZ - item.maxZ, 0, item.minZ - extents.maxZ));
          };
          const path = new THREE.Box3().setFromObject(scene.getObjectByName('farm-path-edge'));
          const pathBoxGap = distance({ kind: 'box', minX: path.min.x, maxX: path.max.x, minZ: path.min.z, maxZ: path.max.z });
          const nearest = obstacles.filter((item) => !item.name.startsWith('sheepfold-') && !/^sheep-\d+$/.test(item.name))
            .map((item) => ({ name: item.name, distance: distance(item) })).sort((a, b) => a.distance - b.distance).slice(0, 5);
          const sheep = [1, 2].map((index) => {
            const animal = scene.getObjectByName(`sheep-${index}`);
            const lobes = [1, 2, 3].map((lobe) => scene.getObjectByName(`sheep-${index}-wool-${lobe}`));
            const inverse = animal.matrixWorld.clone().invert();
            const localBounds = (mesh) => {
              mesh.geometry.computeBoundingBox();
              return mesh.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
            };
            const body = lobes.reduce((box, lobe) => box.union(localBounds(lobe)), new THREE.Box3());
            const bodyWorld = lobes.reduce((box, lobe) => box.union(new THREE.Box3().setFromObject(lobe)), new THREE.Box3());
            const entire = new THREE.Box3().setFromObject(animal);
            const shadow = scene.getObjectByName(`sheep-${index}-shadow`);
            const delta = shadow.getWorldPosition(new THREE.Vector3()).sub(animal.getWorldPosition(new THREE.Vector3()));
            const face = scene.getObjectByName(`sheep-${index}-face`);
            const leg = animal.children.find((child) => child.name.endsWith('-leg'));
            return { total: size(entire), woolBody: size(body), baseY: entire.min.y - 2.4,
              woolBodyWorldAabb: size(bodyWorld), yawDegrees: THREE.MathUtils.radToDeg(animal.rotation.y),
              headProtrusion: localBounds(face).max.z - body.max.z, exposedLegHeight: body.min.y,
              legSize: [leg.geometry.parameters.width, leg.geometry.parameters.height, leg.geometry.parameters.depth],
              wool: lobes.map((lobe) => lobe.material.color.getHexString()),
              face: face.material.color.getHexString(), faceVertexMultiplier: face.geometry.getAttribute('color')?.getX(0) ?? 1,
              shadowOffsetXZ: [delta.x, delta.z], shadowColor: shadow.material.color.getHexString() };
          });
          const shelter = obstacles.find((item) => item.name === 'sheepfold-lean-to');
          const roof = new THREE.Box3().setFromObject(scene.getObjectByName('sheepfold-roof'));
          return { fenceSegments: fences.length, extents, fenceVisualSize: size(fenceVisual),
            fenceVisualBounds: { minX: fenceVisual.min.x, maxX: fenceVisual.max.x, minZ: fenceVisual.min.z, maxZ: fenceVisual.max.z },
            rimGap: 8 - Math.max(...Object.values(extents).map(Math.abs)), pathBoxGap, nearest,
            shelter: { width: shelter.maxX - shelter.minX, depth: shelter.maxZ - shelter.minZ,
              roofSize: size(roof), top: roof.max.y - 2.4 }, sheep };
        });
      }
      if (!previousHead) await page.evaluate((sheepDelta) => {
        const { scene, composer } = window.__ebr70Gate;
        const fold = scene.getObjectByName('farm-sheepfold');
        if (!fold) throw new Error('Candidate is missing the sheepfold');
        if (sheepDelta) {
          for (const index of [1, 2]) {
            const sheep = scene.getObjectByName(`sheep-${index}`);
            if (!sheep) throw new Error(`Missing sheep ${index}`);
            sheep.visible = false;
          }
        } else fold.visible = false;
        composer.render(0);
      }, sheepDelta);
      if (!previousHead) hiddenFold = await screenshot();
      hidden = hiddenFold;
      if (!previousHead && !sheepDelta && scenario.setup === 'placement-rejected') {
        await page.evaluate(() => {
          const { obstacles, placement, composer } = window.__ebr70Gate;
          // Isolate the required feedback: only the new placement keep-out and
          // associated physical obstacles are removed in this test-only frame.
          for (let i = obstacles.length - 1; i >= 0; i--) {
            if (obstacles[i].name.startsWith('sheepfold-') || /^sheep-\d+$/.test(obstacles[i].name)) obstacles.splice(i, 1);
          }
          placement.update();
          composer.render(0);
        });
        assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
        hidden = await screenshot();
      }
    }
    await cdp.detach();
    assert.deepEqual(errors, []);
    return { png, hiddenFold, hidden, state, crops, cropBounds, geometry, hudRects, placementStatus };
  } finally {
    await context.close();
  }
}
