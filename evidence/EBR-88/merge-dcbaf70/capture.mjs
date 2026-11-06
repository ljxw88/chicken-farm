// Compare merged rain to both the new main and the signed EBR-88 worktrees.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = dirname(fileURLToPath(import.meta.url));
const candidateRoot = resolve(output, '../../..');
const mainRoot = resolve(process.argv[2] ?? '/tmp/ebr88-main-dcbaf70-michael');
const signedRoot = resolve(process.argv[3] ?? '/tmp/ebr88-signed-6c3c03a-michael');
const mainSha = 'dcbaf70b8f2c1038afe5c0b70f506ec7de931214';
const signedSha = '6c3c03a6c5bfe12ad98de019f7abc757897680c4';
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(git(mainRoot, 'rev-parse', 'HEAD'), mainSha);
assert.equal(git(signedRoot, 'rev-parse', 'HEAD'), signedSha);
assert.equal(git(mainRoot, 'status', '--porcelain'), '', 'new main worktree must be clean');
assert.equal(git(signedRoot, 'status', '--porcelain'), '', 'signed worktree must be clean');
const candidateSha = git(candidateRoot, 'rev-parse', 'HEAD');
const sourceStatus = git(candidateRoot, 'status', '--porcelain', '--', 'src', 'index.html', 'package.json', 'package-lock.json');
assert.equal(sourceStatus, '', 'candidate source must be committed');
const signedSettings = await readFile(join(signedRoot, 'src/weather/rainSettings.ts'));
assert.ok(signedSettings.equals(await readFile(join(candidateRoot, 'src/weather/rainSettings.ts'))), 'signed RAIN_LOOK changed');
for (const file of ['createRainEffect.ts', 'createWeatherSystem.ts']) {
  const normalize = (text) => text.replaceAll('../scene/farmCollisions', '../character/farmCollisions');
  assert.equal(normalize(await readFile(join(signedRoot, 'src/weather', file), 'utf8')),
    normalize(await readFile(join(candidateRoot, 'src/weather', file), 'utf8')), `${file}: changes beyond the moved type import`);
}

const viewport = { width: 1280, height: 720 };
const seed = 0xeb730001;
const scenarios = [
  { name: 'day-clear', phase: 'daytime', weather: 'clear', steps: 0 },
  { name: 'day-cloudy', phase: 'daytime', weather: 'cloudy', steps: 25 },
  { name: 'day-rain', phase: 'daytime', weather: 'rain', steps: 25 },
  { name: 'night-rain', phase: 'night', weather: 'rain', steps: 25 },
  { name: 'day-rain-walk', phase: 'daytime', weather: 'rain', steps: 25, walk: true },
];
for (const directory of ['main', 'signed', 'merged', 'diff']) await mkdir(join(output, directory), { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
try {
  const signedMetadata = JSON.parse(await readFile(join(signedRoot, 'evidence/EBR-88/comparison.json'), 'utf8'));
  assert.equal(browser.version(), signedMetadata.browser, 'use the signed evidence browser version');
  assert.equal(seed, signedMetadata.seed, 'use the signed evidence seed');
  assert.deepEqual(viewport, signedMetadata.viewport);
  assert.equal(signedMetadata.deviceScaleFactor, 1);
  const captures = {};
  for (const [label, root] of [['main', mainRoot], ['signed', signedRoot], ['merged', candidateRoot]]) {
    captures[label] = await captureTree(label, root);
  }
  const prior = join(signedRoot, 'evidence/EBR-88/after');
  for (const name of ['day-clear', 'day-cloudy', 'day-rain', 'night-rain']) {
    assert.equal(captures.signed[name].sha256, hash(await readFile(join(prior, `${name}.png`))),
      `${name}: recapture differs from the signed tip's evidence`);
    if (name.endsWith('rain')) {
      assert.equal(captures.signed[name].noStreakSha256, hash(await readFile(join(prior, `${name}-no-streaks.png`))),
        `${name}: signed streak mask reference differs`);
    }
  }

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const results = {};
  for (const scenario of scenarios) {
    const name = scenario.name;
    const main = captures.main[name], signed = captures.signed[name], merged = captures.merged[name];
    for (const key of ['position', 'yaw', 'camera', 'cameraQuaternion', 'pixel', 'weather', 'phase', 'hud']) {
      assert.deepEqual(merged.state[key], main.state[key], `${name}: ${key} differs from main`);
      assert.deepEqual(merged.state[key], signed.state[key], `${name}: ${key} differs from signed tip`);
    }
    const images = [join(output, 'main', `${name}.png`), join(output, 'signed', `${name}.png`),
      join(output, 'merged', `${name}.png`)];
    if (scenario.weather === 'rain') {
      images.push(join(output, 'main', `${name}-no-streaks.png`), join(output, 'signed', `${name}-no-streaks.png`),
        join(output, 'merged', `${name}-no-streaks.png`));
    }
    const data = await Promise.all(images.map(async (path) => (await readFile(path)).toString('base64')));
    const compared = await page.evaluate(async ({ data, rainy }) => {
      async function pixels(encoded) {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      }
      const [main, signed, merged, mainNoStreak, signedNoStreak, mergedNoStreak] = await Promise.all(data.map(pixels));
      const different = (a, b, i) => a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] ||
        a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3];
      const canvas = document.createElement('canvas');
      canvas.width = main.width; canvas.height = main.height;
      const context = canvas.getContext('2d');
      const mainDiff = context.createImageData(main.width, main.height);
      const signedDiff = context.createImageData(main.width, main.height);
      const outside = context.createImageData(main.width, main.height);
      let mainRaw = 0, signedRaw = 0, outsideStreakMask = 0, mainWithoutStreaks = 0;
      let signedMaskChanged = 0, signedStreakPixelsChanged = 0, signedWithoutStreaks = 0;
      for (let i = 0; i < main.data.length; i += 4) {
        const mainChanged = different(main, merged, i);
        const signedChanged = different(signed, merged, i);
        if (mainChanged) { mainRaw++; mainDiff.data[i] = 255; mainDiff.data[i + 2] = 255; }
        if (signedChanged) { signedRaw++; signedDiff.data[i] = 255; signedDiff.data[i + 2] = 255; }
        if (rainy) {
          const mainStreak = different(main, mainNoStreak, i);
          const signedStreak = different(signed, signedNoStreak, i);
          const mergedStreak = different(merged, mergedNoStreak, i);
          if (mainChanged && !mainStreak && !mergedStreak) {
            outsideStreakMask++; outside.data[i] = 255; outside.data[i + 2] = 255;
          }
          if (different(mainNoStreak, mergedNoStreak, i)) mainWithoutStreaks++;
          if (different(signedNoStreak, mergedNoStreak, i)) signedWithoutStreaks++;
          if (signedStreak !== mergedStreak) signedMaskChanged++;
          if ((signedStreak || mergedStreak) && signedChanged) signedStreakPixelsChanged++;
        }
        mainDiff.data[i + 3] = signedDiff.data[i + 3] = outside.data[i + 3] = 255;
      }
      const png = (image) => { context.putImageData(image, 0, 0); return canvas.toDataURL('image/png').split(',')[1]; };
      return { mainRaw, signedRaw, outsideStreakMask, mainWithoutStreaks, signedMaskChanged,
        signedStreakPixelsChanged, signedWithoutStreaks, mainDiff: png(mainDiff), signedDiff: png(signedDiff),
        outside: rainy ? png(outside) : undefined };
    }, { data, rainy: scenario.weather === 'rain' });
    await writeFile(join(output, 'diff', `${name}-main-vs-merged.png`), Buffer.from(compared.mainDiff, 'base64'));
    await writeFile(join(output, 'diff', `${name}-signed-vs-merged.png`), Buffer.from(compared.signedDiff, 'base64'));
    assert.equal(compared.signedRaw, 0, `${name}: frame differs from the signed tip`);
    assert.equal(signed.state.geometrySha256, merged.state.geometrySha256, `${name}: signed streak geometry changed`);
    if (scenario.weather === 'rain') {
      await writeFile(join(output, 'diff', `${name}-outside-streak-mask.png`), Buffer.from(compared.outside, 'base64'));
      assert.equal(compared.mainWithoutStreaks, 0, `${name}: new main differs with streaks hidden`);
      assert.equal(compared.outsideStreakMask, 0, `${name}: pixels changed outside streaks`);
      assert.equal(compared.signedMaskChanged, 0, `${name}: signed streak footprint changed`);
      assert.equal(compared.signedStreakPixelsChanged, 0, `${name}: signed streak pixels changed`);
      assert.equal(compared.signedWithoutStreaks, 0, `${name}: signed non-streak pixels changed`);
    } else {
      assert.equal(compared.mainRaw, 0, `${name}: changed against new main`);
    }
    const { mainDiff, signedDiff, outside, ...counts } = compared;
    results[name] = { ...counts, mainFrameSha256: main.sha256, signedFrameSha256: signed.sha256,
      mergedFrameSha256: merged.sha256, hudStateIdentical: true,
      signedGeometrySha256: signed.state.geometrySha256, mergedGeometrySha256: merged.state.geometrySha256,
      signedGeometryIdentical: signed.state.geometrySha256 === merged.state.geometrySha256, mainCloud: main.state.cloud,
      signedCloud: signed.state.cloud, mergedCloud: merged.state.cloud, position: merged.state.position };
    console.log(`${name}: ${JSON.stringify(results[name])}`);
  }
  await page.close();
  const summary = { mainSha, signedSha, candidateSha, sourceStatus, signedRainSettingsSha256: hash(signedSettings),
    browser: browser.version(), viewport, deviceScaleFactor: 1, seed, results,
    consoleWarningsOrErrors: Object.entries(captures).flatMap(([label, frames]) =>
      Object.entries(frames).flatMap(([name, frame]) => frame.errors.map((error) => `${label}/${name}: ${error}`))) };
  await writeFile(join(output, 'comparison.json'), `${JSON.stringify(summary, null, 2)}\n`);
  assert.deepEqual(summary.consoleWarningsOrErrors, []);
} finally {
  await browser.close();
}

async function captureTree(label, root) {
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const frames = {};
  try {
    for (const scenario of scenarios) frames[scenario.name] = await capture(label, `http://127.0.0.1:${address.port}`, scenario);
    return frames;
  } finally {
    await server.close();
  }
}

async function capture(label, url, scenario) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) && !message.location().url.endsWith('/favicon.ico')) {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  try {
    await page.addInitScript(({ seed }) => {
      let state = seed >>> 0;
      window.__ebr88RandomCalls = 0;
      window.__ebr88Random = () => {
        window.__ebr88RandomCalls++;
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__ebr88Step = (time) => {
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
      await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr88Random,')}
window.__ebr88Merge = { scene, camera, character, controls, follow, weather, composer };\n` });
    });
    await page.goto(`${url}/?phase=${scenario.phase}&weather=${scenario.weather}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((steps) => {
      window.__ebr88Step(0);
      for (let i = 1; i <= steps; i++) window.__ebr88Step(i * 100);
    }, scenario.steps);
    if (scenario.walk) {
      await page.keyboard.down('s');
      await page.evaluate((steps) => { for (let i = 1; i <= 8; i++) window.__ebr88Step((steps + i) * 100); }, scenario.steps);
      await page.keyboard.up('s');
    }
    const state = await page.evaluate(() => {
      const { scene, camera, character } = window.__ebr88Merge;
      const streaks = scene.getObjectByName('rain-streaks');
      scene.updateMatrixWorld(true); camera.updateMatrixWorld();
      const cloud = streaks.parent.getWorldPosition(character.position.clone()).toArray();
      const hud = [...document.querySelectorAll('#farm-hud, .placement-controls')].map((root) => ({
        html: root.outerHTML,
        boxes: [root, ...root.querySelectorAll('*')].map((node) => {
          const rect = node.getBoundingClientRect();
          return [rect.x, rect.y, rect.width, rect.height];
        }),
      }));
      return { position: character.position.toArray(), yaw: character.rotation.y, camera: camera.position.toArray(),
        cameraQuaternion: camera.quaternion.toArray(), pixel: window.getPixelRendering(), weather: window.getWeather(),
        phase: document.querySelector('[data-phase]')?.textContent, cloud, hud,
        geometry: [...streaks.geometry.attributes.position.array], randomCalls: window.__ebr88RandomCalls };
    });
    const floats = Float32Array.from(state.geometry);
    state.geometrySha256 = hash(Buffer.from(floats.buffer));
    delete state.geometry;
    assert.equal(state.weather.mode, scenario.weather);
    if (scenario.weather !== 'clear') assert.equal(state.weather[`${scenario.weather}Amount`], 1);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight, state.pixel.devicePixelRatio], [320, 180, 1]);
    if (scenario.weather === 'rain') {
      assert.ok(Math.abs(state.cloud[0] - state.position[0]) < 1e-8 && Math.abs(state.cloud[2] - state.position[2]) < 1e-8,
        `${label}/${scenario.name}: rain field is not centred on the player`);
    }
    if (scenario.walk) assert.ok(Math.hypot(state.position[0], state.position[2]) > 1, 'walking did not move the player');
    const cdp = await context.newCDPSession(page);
    async function shot(path) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const bytes = Buffer.from(screenshot.data, 'base64');
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1280, 720]);
      await writeFile(path, bytes);
      return hash(bytes);
    }
    const path = join(output, label, scenario.name);
    const sha256 = await shot(`${path}.png`);
    let noStreakSha256;
    if (scenario.weather === 'rain') {
      await page.evaluate(() => {
        const { scene, composer } = window.__ebr88Merge;
        scene.getObjectByName('rain-streaks').visible = false;
        composer.render(0);
      });
      noStreakSha256 = await shot(`${path}-no-streaks.png`);
    }
    await cdp.detach();
    assert.deepEqual(errors, [], `${label}/${scenario.name}: browser console`);
    console.log(`captured ${label}/${scenario.name}`);
    return { sha256, noStreakSha256, state, errors };
  } finally {
    await context.close();
  }
}
