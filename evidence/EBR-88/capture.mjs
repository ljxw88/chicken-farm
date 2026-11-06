// Reproduce the EBR-88 frames against a clean, detached 9e8c8c6 worktree.
// Run after Gate G: node evidence/EBR-88/capture.mjs /tmp/<main-worktree>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = dirname(fileURLToPath(import.meta.url));
const candidateRoot = resolve(output, '../..');
const baselineRoot = resolve(process.argv[2] ?? '/tmp/ebr88-main-9e8c8c6-michael');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const baselineSha = git(baselineRoot, 'rev-parse', 'HEAD');
assert.equal(baselineSha, '9e8c8c6c479567fcb4c7796763e86ceb6d6b72a4');
assert.equal(git(baselineRoot, 'status', '--porcelain'), '', 'main worktree must be clean');
const candidateSha = git(candidateRoot, 'rev-parse', 'HEAD');
const sourceStatus = git(candidateRoot, 'status', '--porcelain', '--', 'src', 'index.html', 'package.json', 'package-lock.json');
assert.equal(sourceStatus, '', 'commit the candidate source before capture');

const viewport = { width: 1280, height: 720 };
const seed = 0xeb730001;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scenarios = [
  { name: 'day-clear', phase: 'daytime', weather: 'clear', steps: 0 },
  { name: 'day-cloudy', phase: 'daytime', weather: 'cloudy', steps: 25 },
  { name: 'day-rain', phase: 'daytime', weather: 'rain', steps: 25 },
  { name: 'night-rain', phase: 'night', weather: 'rain', steps: 25 },
];
for (const folder of ['before', 'after', 'diff', 'crops', 'follow']) {
  await mkdir(join(output, folder), { recursive: true });
}
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
});
try {
  const gate = JSON.parse(await readFile(join(output, 'gate-g/baseline.json'), 'utf8'));
  assert.equal(browser.version(), gate.browser, 'use the QA baseline Chromium version');
  const before = await captureTree(baselineRoot, 'before');
  const after = await captureTree(candidateRoot, 'after');
  assert.equal(before['day-clear'].sha256, gate.frames.spawn.sha256, 'main clear must match the QA baseline');
  assert.equal(before['day-rain'].sha256, gate.frames.rain.sha256, 'main rain must match the QA baseline');
  assert.equal(after['day-clear'].sha256, hash(await readFile(join(output, 'gate-g/candidate/spawn.png'))));
  assert.equal(after['day-rain'].sha256, hash(await readFile(join(output, 'gate-g/candidate/rain.png'))));

  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const results = {};
  for (const scenario of scenarios) {
    const name = scenario.name;
    const a = before[name];
    const b = after[name];
    for (const key of ['position', 'camera', 'cameraQuaternion', 'pixel', 'weather', 'phase', 'hud', 'hudBounds']) {
      assert.deepEqual(b.state[key], a.state[key], `${name}: ${key} changed`);
    }
    const images = [
      join(output, 'before', `${name}.png`), join(output, 'after', `${name}.png`),
      join(output, 'before', `${name}-hud-only.png`), join(output, 'after', `${name}-hud-only.png`),
    ];
    if (scenario.weather === 'rain') {
      images.push(
        join(output, 'before', `${name}-no-streaks.png`), join(output, 'after', `${name}-no-streaks.png`),
        join(output, 'before', `${name}-no-rain.png`), join(output, 'after', `${name}-no-rain.png`),
      );
    }
    const data = await Promise.all(images.map(async (path) => (await readFile(path)).toString('base64')));
    const comparison = await page.evaluate(async ({ data, rain, hudBounds }) => {
      async function pixels(encoded) {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
      const frames = await Promise.all(data.map(pixels));
      const [a, b, hudA, hudB, noStreakA, noStreakB, noRainA, noRainB] = frames;
      const different = (x, y, i) => x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] ||
        x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3];
      const canvas = document.createElement('canvas');
      canvas.width = a.width;
      canvas.height = a.height;
      const ctx = canvas.getContext('2d');
      const raw = ctx.createImageData(a.width, a.height);
      const outside = ctx.createImageData(a.width, a.height);
      const mask = ctx.createImageData(a.width, a.height);
      const regions = {
        grass: { box: [300, 300, 180, 110], changed: 0, beforeStreakPixels: 0, afterStreakPixels: 0, afterSurfacePixels: 0 },
        roof: { box: [548, 168, 155, 110], changed: 0, beforeStreakPixels: 0, afterStreakPixels: 0, afterSurfacePixels: 0 },
      };
      const regionEntries = Object.entries(regions);
      let changed = 0, hudChanged = 0, rawChangedWithinHudBounds = 0, withoutStreaks = 0, withoutRain = 0;
      let outsideStreakMask = 0, outsideRainMask = 0, rainMaskPixels = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        const rawDiff = different(a, b, i);
        if (rawDiff) {
          changed++;
          const x = (i / 4) % a.width, y = Math.floor(i / 4 / a.width);
          if (hudBounds.some(([left, top, width, height]) =>
            x >= left && x < left + width && y >= top && y < top + height)) rawChangedWithinHudBounds++;
        }
        if (different(hudA, hudB, i)) hudChanged++;
        let streakMask = false, rainMask = false, streakA = false, streakB = false;
        if (rain) {
          streakA = different(a, noStreakA, i);
          streakB = different(b, noStreakB, i);
          const splashA = different(noStreakA, noRainA, i);
          const splashB = different(noStreakB, noRainB, i);
          streakMask = streakA || streakB;
          rainMask = streakMask || splashA || splashB;
          if (different(noStreakA, noStreakB, i)) withoutStreaks++;
          if (different(noRainA, noRainB, i)) withoutRain++;
          if (rawDiff && !streakMask) outsideStreakMask++;
          if (rawDiff && !rainMask) outsideRainMask++;
          if (rainMask) rainMaskPixels++;
          const x = (i / 4) % a.width, y = Math.floor(i / 4 / a.width);
          for (const [name, region] of regionEntries) {
            const [left, top, width, height] = region.box;
            if (x < left || x >= left + width || y < top || y >= top + height) continue;
            if (rawDiff) region.changed++;
            if (streakA) region.beforeStreakPixels++;
            if (streakB) {
              region.afterStreakPixels++;
              const red = noStreakB.data[i], green = noStreakB.data[i + 1], blue = noStreakB.data[i + 2];
              const surface = name === 'grass' ? green >= 28 && green > red * 1.2 && green > blue * 1.2 :
                red >= 40 && red > green * 1.4 && green > blue * 1.1;
              if (surface) region.afterSurfacePixels++;
            }
          }
        }
        if (rawDiff) { raw.data[i] = 255; raw.data[i + 2] = 255; }
        if (rawDiff && !rainMask) { outside.data[i] = 255; outside.data[i + 2] = 255; }
        if (rainMask) { mask.data[i] = 255; mask.data[i + 2] = 255; }
        raw.data[i + 3] = outside.data[i + 3] = mask.data[i + 3] = 255;
      }
      const png = (image) => {
        ctx.putImageData(image, 0, 0);
        return canvas.toDataURL('image/png').split(',')[1];
      };
      const sample = (360 * a.width + 320) * 4;
      return { changed, hudChanged, rawChangedWithinHudBounds, withoutStreaks, withoutRain, outsideStreakMask, outsideRainMask,
        rainMaskPixels, regions: rain ? regions : undefined,
        grassSampleAt320x360: { before: [...a.data.slice(sample, sample + 3)], after: [...b.data.slice(sample, sample + 3)] },
        raw: png(raw), outside: rain ? png(outside) : undefined, mask: rain ? png(mask) : undefined };
    }, { data, rain: scenario.weather === 'rain', hudBounds: a.state.hudBounds });
    await writeFile(join(output, 'diff', `${name}.png`), Buffer.from(comparison.raw, 'base64'));
    if (scenario.weather === 'rain') {
      await writeFile(join(output, 'diff', `${name}-rain-mask.png`), Buffer.from(comparison.mask, 'base64'));
      await writeFile(join(output, 'diff', `${name}-outside-rain-mask.png`), Buffer.from(comparison.outside, 'base64'));
      assert.equal(comparison.withoutStreaks, 0, `${name}: non-streak rain pixels changed in this frame`);
      assert.equal(comparison.outsideStreakMask, 0, `${name}: changes outside the rendered streak mask`);
      assert.equal(comparison.withoutRain, 0, `${name}: scene differs with rain effect hidden`);
      assert.equal(comparison.outsideRainMask, 0, `${name}: changes outside the actual rain effect mask`);
      for (const surface of ['grass', 'roof']) {
        assert.ok(comparison.regions[surface].afterSurfacePixels > 0, `${name}: no visible streaks over ${surface}`);
      }
    } else {
      assert.equal(comparison.changed, 0, `${name} changed`);
    }
    assert.equal(comparison.hudChanged, 0, `${name}: isolated HUD changed`);
    const { raw, outside, mask, ...counts } = comparison;
    results[name] = { ...counts, hudDomAndLayoutIdentical: true,
      beforeRandomCalls: a.state.randomCalls, afterRandomCalls: b.state.randomCalls,
      beforeSplashes: a.state.splashes, afterSplashes: b.state.splashes,
      beforeRainGeometry: a.state.rainGeometry, afterRainGeometry: b.state.rainGeometry };
    console.log(`${name}: ${JSON.stringify(results[name])}`);
  }

  // Crops come directly from the full 1280x720 frames, enlarged without interpolation.
  for (const phase of ['day', 'night']) {
    for (const version of ['before', 'after']) {
      const image = (await readFile(join(output, version, `${phase}-rain.png`))).toString('base64');
      for (const crop of [{ name: 'grass', x: 300, y: 300, width: 180, height: 110 },
        { name: 'roof', x: 548, y: 168, width: 155, height: 110 }]) {
        const png = await page.evaluate(async ({ image, crop }) => {
          const source = new Image();
          source.src = `data:image/png;base64,${image}`;
          await source.decode();
          const canvas = document.createElement('canvas');
          canvas.width = crop.width * 4;
          canvas.height = crop.height * 4;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/png').split(',')[1];
        }, { image, crop });
        await writeFile(join(output, 'crops', `${version}-${phase}-${crop.name}-4x.png`), Buffer.from(png, 'base64'));
      }
    }
  }

  const followPixels = { before: await compareFollow(page, 'before'), after: await compareFollow(page, 'after') };
  assert.equal(followPixels.before.changedAfterTranslation, 0, 'main camera-follow reference shimmered');
  assert.equal(followPixels.after.changedAfterTranslation, 0, 'rain changed under an exact one-pixel camera shift');
  const summary = { baselineSha, candidateSha, sourceStatus, browser: browser.version(), viewport,
    deviceScaleFactor: 1, seed, results, cameraFollow: { before: before['day-rain'].follow, after: after['day-rain'].follow }, followPixels,
    consoleWarningsOrErrors: [...Object.values(before), ...Object.values(after)].flatMap((frame) => frame.errors),
    crops: { scale: 4, filter: 'nearest-neighbour', grass: [300, 300, 180, 110], roof: [548, 168, 155, 110] } };
  await writeFile(join(output, 'comparison.json'), `${JSON.stringify(summary, null, 2)}\n`);
  assert.deepEqual(summary.consoleWarningsOrErrors, []);
  console.log(`camera follow: ${JSON.stringify({ world: summary.cameraFollow, pixels: followPixels })}`);
  await page.close();
} finally {
  await browser.close();
}

async function captureTree(root, label) {
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const frames = {};
  try {
    for (const scenario of scenarios) frames[scenario.name] = await capture(url, label, scenario);
    return frames;
  } finally {
    await server.close();
  }
}

async function capture(url, label, scenario) {
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
window.__ebr88 = { scene, camera, character, follow, weather, composer };\n` });
    });
    await page.goto(`${url}/?phase=${scenario.phase}&weather=${scenario.weather}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((steps) => {
      window.__ebr88Step(0);
      for (let i = 1; i <= steps; i++) window.__ebr88Step(i * 100);
    }, scenario.steps);
    const state = await page.evaluate(() => {
      const { scene, camera, character } = window.__ebr88;
      const hud = [...document.querySelectorAll('#farm-hud, .placement-controls')].map((root) => ({
        html: root.outerHTML,
        nodes: [root, ...root.querySelectorAll('*')].map((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return { box: [rect.x, rect.y, rect.width, rect.height],
            style: [style.display, style.visibility, style.color, style.font, style.background, style.borderRadius, style.opacity] };
        }),
      }));
      const hudBounds = [...document.querySelectorAll('.farm-biome, .placement-toolbar')].map((node) => {
        const rect = node.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      });
      const splashes = Array.from({ length: 6 }, (_, i) => scene.getObjectByName(`rain-splash-${i + 1}`))
        .filter((splash) => splash.visible)
        .map((splash) => ({ position: splash.position.toArray(), radius: splash.scale.x }));
      let rainGeometry;
      if (window.getWeather().mode === 'rain') {
        scene.updateMatrixWorld(true);
        camera.updateMatrixWorld();
        const streaks = scene.getObjectByName('rain-streaks');
        const positions = streaks.geometry.attributes.position;
        const light = scene.getObjectByName('day-night-directional');
        const away = light.target.getWorldPosition(character.position.clone())
          .sub(light.getWorldPosition(character.position.clone())).setY(0).normalize();
        let minLength = Infinity, maxLength = 0, minHeight = Infinity, maxHeight = 0;
        let minAngle = Infinity, maxAngle = -Infinity, direction;
        for (let i = 0; i < positions.count; i += 2) {
          const top = streaks.localToWorld(character.position.clone().fromBufferAttribute(positions, i));
          const bottom = streaks.localToWorld(character.position.clone().fromBufferAttribute(positions, i + 1));
          const delta = bottom.clone().sub(top);
          const length = delta.length();
          minLength = Math.min(minLength, length); maxLength = Math.max(maxLength, length);
          if (!direction) direction = delta.clone().setY(0).normalize().toArray();
          top.project(camera); bottom.project(camera);
          const dx = (bottom.x - top.x) * 160;
          const dy = (top.y - bottom.y) * 90;
          const angle = Math.atan2(dx, dy) * 180 / Math.PI;
          minHeight = Math.min(minHeight, dy); maxHeight = Math.max(maxHeight, dy);
          minAngle = Math.min(minAngle, angle); maxAngle = Math.max(maxAngle, angle);
        }
        const separation = Math.acos(Math.max(-1, Math.min(1, direction[0] * away.x + direction[2] * away.z))) * 180 / Math.PI;
        rainGeometry = { streaks: positions.count / 2, color: streaks.material.color.getHex(), opacity: streaks.material.opacity,
          worldLengthRange: [minLength, maxLength], direction, shadowDirection: away.toArray(), separationDegrees: separation,
          screenTiltDegrees: [minAngle, maxAngle], lowResolutionHeightPixels: [minHeight, maxHeight] };
      }
      return { position: character.position.toArray(), camera: camera.position.toArray(),
        cameraQuaternion: camera.quaternion.toArray(), pixel: window.getPixelRendering(),
        weather: window.getWeather(), phase: document.querySelector('[data-phase]')?.textContent,
        randomCalls: window.__ebr88RandomCalls, hud, hudBounds, splashes, rainGeometry };
    });
    assert.equal(state.weather.mode, scenario.weather);
    if (scenario.weather !== 'clear') assert.equal(state.weather[`${scenario.weather}Amount`], 1);
    assert.deepEqual([state.pixel.canvasWidth, state.pixel.canvasHeight], [320, 180]);
    const cdp = await context.newCDPSession(page);
    async function shot(path) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const bytes = Buffer.from(screenshot.data, 'base64');
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1280, 720]);
      await writeFile(path, bytes);
      return hash(bytes);
    }
    const frame = join(output, label, scenario.name);
    const sha256 = await shot(`${frame}.png`);
    if (scenario.weather === 'rain') {
      await page.evaluate(() => {
        const { scene, composer } = window.__ebr88;
        scene.getObjectByName('rain-streaks').visible = false;
        composer.render(0);
      });
      await shot(`${frame}-no-streaks.png`);
      await page.evaluate(() => {
        const { scene, composer } = window.__ebr88;
        scene.getObjectByName('weather-rain').visible = false;
        composer.render(0);
      });
      await shot(`${frame}-no-rain.png`);
    }
    await page.evaluate(() => { document.querySelector('#scene').style.visibility = 'hidden'; });
    await shot(`${frame}-hud-only.png`);
    let follow;
    if (scenario.name === 'day-rain') follow = await captureFollow(page, shot, label);
    await cdp.detach();
    assert.deepEqual(errors, [], `${label}/${scenario.name}: browser console`);
    console.log(`captured ${label}/${scenario.name}`);
    return { sha256, state, errors, follow };
  } finally {
    await context.close();
  }
}

async function captureFollow(page, shot, label) {
  const result = await page.evaluate((fieldWidth) => {
    const { scene, camera, character, follow, weather } = window.__ebr88;
    const streaks = scene.getObjectByName('rain-streaks');
    scene.getObjectByName('weather-rain').visible = true;
    streaks.visible = true;
    document.querySelector('#scene').style.visibility = '';
    const positions = streaks.geometry.attributes.position;
    const endpoints = () => {
      scene.updateMatrixWorld(true);
      return Array.from({ length: positions.count }, (_, i) =>
        streaks.localToWorld(character.position.clone().fromBufferAttribute(positions, i)));
    };
    let previous = endpoints(), maxWorldError = 0, wraps = 0;
    for (let frame = 0; frame < 20; frame++) {
      character.position.x += 0.04;
      follow(character.position);
      weather.update(0);
      const current = endpoints();
      current.forEach((point, i) => {
        const dx = point.x - previous[i].x;
        const wrap = Math.round(dx / fieldWidth);
        wraps += Math.abs(wrap);
        maxWorldError = Math.max(maxWorldError, Math.hypot(dx - wrap * fieldWidth,
          point.y - previous[i].y, point.z - previous[i].z));
      });
      previous = current;
    }
    return { frames: 20, streaks: positions.count / 2, endpoints: positions.count, anchorMoveX: 0.8, endpointWraps: wraps, maxWorldError };
  }, label === 'before' ? 24 : 19);
  assert.ok(result.maxWorldError < 1e-5, `camera-follow rain jumped: ${result.maxWorldError}`);
  // Rain-only render, moving the camera by exactly one low-res pixel horizontally.
  // Compare after translating the first image by four CSS pixels; no anchor wrap is involved.
  await page.evaluate(() => {
    const { scene, composer } = window.__ebr88;
    scene.children.forEach((object) => { if (object.name !== 'weather-rain') object.visible = false; });
    for (let i = 1; i <= 6; i++) scene.getObjectByName(`rain-splash-${i}`).visible = false;
    document.querySelector('#farm-hud').style.visibility = 'hidden';
    document.querySelector('.placement-controls').style.visibility = 'hidden';
    composer.render(0);
  });
  await shot(join(output, 'follow', `${label}-rain-only-before-move.png`));
  await page.evaluate(() => {
    const { camera, character, follow, composer } = window.__ebr88;
    const screenRight = character.position.clone().setFromMatrixColumn(camera.matrixWorld, 0);
    follow(character.position.clone().addScaledVector(screenRight, 1 / 9));
    composer.render(0);
  });
  await shot(join(output, 'follow', `${label}-rain-only-one-pixel-camera-move.png`));
  return result;
}

async function compareFollow(page, label) {
  const data = await Promise.all(['rain-only-before-move.png', 'rain-only-one-pixel-camera-move.png']
    .map(async (name) => (await readFile(join(output, 'follow', `${label}-${name}`))).toString('base64')));
  return page.evaluate(async (data) => {
    async function pixels(encoded) {
      const image = new Image();
      image.src = `data:image/png;base64,${encoded}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height).data;
    }
    const [before, after] = await Promise.all(data.map(pixels));
    let changed = 0;
    for (let y = 0; y < 720; y++) {
      for (let x = 0; x < 1276; x++) {
        const a = (y * 1280 + x + 4) * 4, b = (y * 1280 + x) * 4;
        if (before[a] !== after[b] || before[a + 1] !== after[b + 1] || before[a + 2] !== after[b + 2]) changed++;
      }
    }
    return { cameraShiftCssPixels: 4, comparedPixels: 1276 * 720, changedAfterTranslation: changed };
  }, data);
}
