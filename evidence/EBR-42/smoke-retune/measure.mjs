import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { captureSourceSnapshot } from '../source-snapshot.mjs';

// Measure actual rendered smoke, not the material colour or an unmasked roof.
// Each puff is hidden in turn at a fixed frame; exclusive pixels are those
// changed by that puff and by no other puff in the same composite.
const base = (process.env.EBR42_URL || 'http://100.88.150.21:5212').replace(/\/$/, '');
const evidenceRoot = resolve(process.env.EBR42_EVIDENCE_ROOT || 'evidence/EBR-42');
const output = resolve(process.env.EBR42_SMOKE_OUT || join(evidenceRoot, 'smoke-retune'));
const maskDir = resolve(process.env.EBR42_SMOKE_MASK_DIR || join(evidenceRoot, 'mask/puff-bright'));
const measurementDir = process.env.EBR42_MEASUREMENT_DIR || 'merge-6daf042';
assert.match(measurementDir, /^[a-zA-Z0-9_-]+$/, 'Measurement directory must be a single folder name');
const mergeFrames = join(evidenceRoot, measurementDir, 'luma-frames');
const mergeMasks = join(evidenceRoot, measurementDir, 'luma-masks');
const mergeNoSmoke = join(evidenceRoot, measurementDir, 'luma-no-smoke');
const sourceSnapshot = captureSourceSnapshot();
const { head, sourceStatus } = sourceSnapshot;
const seed = 0xeb730001;
const cases = (process.env.EBR42_SMOKE_CASES || 'daytime-clear,daytime-cloudy,daytime-rain,sunset-clear,sunset-cloudy,sunset-rain,night-clear,night-cloudy,night-rain')
  .split(',').map((name) => {
    const [phase, weather] = name.split('-');
    if (!['morning', 'daytime', 'sunset', 'night'].includes(phase) || !['clear', 'cloudy', 'rain'].includes(weather)) {
      throw new Error(`Invalid phase/weather case: ${name}`);
    }
    return { name, phase, weather };
  });
const frameTimes = [2500, 3000, 3500];
const hash = (data) => createHash('sha256').update(data).digest('hex');
await mkdir(output, { recursive: true });
await mkdir(maskDir, { recursive: true });
await mkdir(mergeFrames, { recursive: true });
await mkdir(mergeMasks, { recursive: true });
await mkdir(mergeNoSmoke, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
const report = {
  head, sourceStatus, sourceSnapshot, browser: browser.version(), viewport: [1280, 720], pixelBuffer: [320, 180], seed,
  method: {
    luminance: '0.2126 R + 0.7152 G + 0.0722 B, on 0–255 sRGB pixels',
    contribution: 'A pixel on pure void meets the phase threshold and loses at least 5 luma when this puff alone is hidden; puffs may share pixels.',
    exclusive: 'A threshold pixel on pure void changes when this puff is hidden but not when any other puff is hidden.',
    solo: 'Peak on pure void when only this puff is visible; this is not a measurement of the full composite.',
    screenMask: 'Exact 1280×720 screenshot difference between the same frame with and without smoke; the paired frame and binary mask are saved for every sample.',
    checks: 'The exact screen smoke-mask peak is at least 110 by day/sunset and 70 at night; night masks remain dimmer than both front-window samples; no brightening with lights and fog off. Per-puff overlap counts are diagnostic only.',
  },
  cases: {},
};
const failures = [];
const limitations = [];
try {
  for (const scenario of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
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
        window.__smokeStep = (time) => {
          const current = [...callbacks.values()];
          callbacks.clear();
          if (!current.length) throw new Error('No animation frame was scheduled');
          for (const callback of current) callback(time);
        };
      });
      await page.route('**/src/main.ts*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\nwindow.__smokeProbe = { scene, camera, character, renderer, composer, dayNight, weather };\n` });
      });
      await page.goto(`${base}/?phase=${scenario.phase}&weather=${scenario.weather}&seed=${seed}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(window.__smokeProbe));
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => window.__smokeStep(0));
      const cdp = await context.newCDPSession(page);
      let previous = 0;
      const samples = [];
      for (const time of frameTimes) {
        await page.evaluate(({ from, to }) => {
          for (let step = from + 100; step <= to; step += 100) window.__smokeStep(step);
        }, { from: previous, to: time });
        previous = time;
        const target = scenario.phase === 'night' ? 70 : 110;
        const sample = await page.evaluate(({ target, includeMasks }) => {
          const { scene, camera, character, renderer, composer, dayNight, weather } = window.__smokeProbe;
          const smoke = scene.getObjectByName('chimney-smoke');
          const fireflies = scene.getObjectByName('night-fireflies');
          const puffs = smoke.children.filter((puff) => puff.visible);
          const canvas = document.createElement('canvas');
          canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const snapshot = () => {
            composer.render(0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(renderer.domElement, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const full = snapshot();
          smoke.visible = false;
          const withoutSmoke = snapshot();
          smoke.visible = true;
          const withoutEach = puffs.map((puff) => {
            puff.visible = false;
            const pixels = snapshot();
            puff.visible = true;
            return pixels;
          });
          const solo = puffs.map((puff) => {
            for (const item of puffs) item.visible = item === puff;
            return snapshot();
          });
          for (const puff of puffs) puff.visible = true;
          composer.render(0);
          const differs = (a, b, i) => a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2];
          const lum = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
          const voidAt = (a, i) => a[i] === 16 && a[i + 1] === 20 && a[i + 2] === 22;
          const metrics = puffs.map((puff) => ({ name: puff.name, size: puff.scale.x, opacity: puff.material.opacity,
            position: puff.position.toArray(), maskPixels: 0, exclusivePixels: 0, brightContributionPixels: 0,
            peakComposite: 0, peakCompositeVoid: 0, peakExclusive: 0, peakExclusiveVoid: 0,
            peakSolo: 0, peakSoloVoid: 0, peakLift: 0 }));
          const brightMasks = includeMasks ? puffs.map(() => {
            const data = new Uint8ClampedArray(full.length);
            for (let i = 3; i < data.length; i += 4) data[i] = 255;
            return data;
          }) : [];
          let smokePixels = 0; let peakSmokeMask = 0; let peakSmokeVoid = 0; let voidCount = 0;
          const voidRgb = [0, 0, 0];
          for (let i = 0; i < full.length; i += 4) {
            if (differs(full, withoutSmoke, i)) {
              smokePixels++;
              peakSmokeMask = Math.max(peakSmokeMask, lum(full, i));
              if (voidAt(withoutSmoke, i)) {
                peakSmokeVoid = Math.max(peakSmokeVoid, lum(full, i));
                voidCount++;
                for (let channel = 0; channel < 3; channel++) voidRgb[channel] += full[i + channel];
              }
            }
            const affected = [];
            for (let p = 0; p < puffs.length; p++) {
              if (differs(full, withoutEach[p], i)) {
                affected.push(p);
                metrics[p].maskPixels++;
                metrics[p].peakComposite = Math.max(metrics[p].peakComposite, lum(full, i));
                if (voidAt(withoutSmoke, i)) {
                  metrics[p].peakCompositeVoid = Math.max(metrics[p].peakCompositeVoid, lum(full, i));
                  if (lum(full, i) >= target && lum(full, i) - lum(withoutEach[p], i) >= 5) {
                    metrics[p].brightContributionPixels++;
                    if (includeMasks) brightMasks[p][i] = brightMasks[p][i + 1] = brightMasks[p][i + 2] = 255;
                  }
                }
              }
              if (differs(solo[p], withoutSmoke, i)) {
                metrics[p].peakSolo = Math.max(metrics[p].peakSolo, lum(solo[p], i));
                metrics[p].peakLift = Math.max(metrics[p].peakLift, lum(solo[p], i) - lum(withoutSmoke, i));
                if (voidAt(withoutSmoke, i)) metrics[p].peakSoloVoid = Math.max(metrics[p].peakSoloVoid, lum(solo[p], i));
              }
            }
            if (affected.length === 1) {
              const item = metrics[affected[0]];
              item.exclusivePixels++;
              item.peakExclusive = Math.max(item.peakExclusive, lum(full, i));
              if (voidAt(withoutSmoke, i)) item.peakExclusiveVoid = Math.max(item.peakExclusiveVoid, lum(full, i));
            }
          }
          camera.updateMatrixWorld();
          const windows = ['cottage-window-1', 'cottage-window-2'].map((name) => {
            const point = scene.getObjectByName(name).getWorldPosition(camera.position.clone()).project(camera);
            const x = Math.max(0, Math.min(canvas.width - 1, Math.floor((point.x + 1) * canvas.width / 2)));
            const y = Math.max(0, Math.min(canvas.height - 1, Math.floor((1 - point.y) * canvas.height / 2)));
            const i = (y * canvas.width + x) * 4;
            return { name, x, y, rgb: Array.from(full.slice(i, i + 3)), luminance: lum(full, i) };
          });
          const maskPngs = brightMasks.map((data, index) => {
            const source = document.createElement('canvas'); source.width = canvas.width; source.height = canvas.height;
            source.getContext('2d').putImageData(new ImageData(data, canvas.width, canvas.height), 0, 0);
            const enlarged = document.createElement('canvas'); enlarged.width = 1280; enlarged.height = 720;
            const out = enlarged.getContext('2d'); out.imageSmoothingEnabled = false;
            out.drawImage(source, 0, 0, enlarged.width, enlarged.height);
            return { name: metrics[index].name, png: enlarged.toDataURL('image/png').split(',')[1] };
          });
          const state = { character: character.position.toArray(), yaw: character.rotation.y,
            camera: camera.position.toArray(), cameraQuaternion: camera.quaternion.toArray(), cameraZoom: camera.zoom,
            pixel: window.getPixelRendering(), firefliesVisible: fireflies.visible,
            fireflyOpacity: Array.from(fireflies.geometry.getAttribute('instanceOpacity').array),
            fireflyMatrices: Array.from(fireflies.instanceMatrix.array) };
          return { weather: weather.getWeather(), nightAmount: dayNight.getNightAmount(), state, smokePixels,
            peakSmokeMask, peakSmokeVoid, voidMeanRgb: voidCount ? voidRgb.map((value) => value / voidCount) : null,
            windows, puffs: metrics, maskPngs };
        }, { target, includeMasks: time === 3000 });
        const { maskPngs, ...measurements } = sample;
        const screenshot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
        const frame = await screenshot();
        const previousVisibility = await page.evaluate(() => {
          const { scene, composer } = window.__smokeProbe;
          const smoke = scene.getObjectByName('chimney-smoke');
          const wasVisible = smoke.visible;
          smoke.visible = false;
          composer.render(0);
          return wasVisible;
        });
        let withoutSmoke;
        try { withoutSmoke = await screenshot(); }
        finally {
          await page.evaluate((visible) => {
            const { scene, composer } = window.__smokeProbe;
            scene.getObjectByName('chimney-smoke').visible = visible;
            composer.render(0);
          }, previousVisibility);
        }
        const screenMask = await measureScreenMask(page, frame, withoutSmoke);
        const { png, ...screen } = screenMask;
        const name = `${scenario.name}-${time}.png`;
        const screenMaskBytes = Buffer.from(png, 'base64');
        await writeFile(join(mergeFrames, name), frame);
        await writeFile(join(mergeMasks, name), screenMaskBytes);
        await writeFile(join(mergeNoSmoke, name), withoutSmoke);
        samples.push({ time: time / 1000, target, ...measurements, screenMask: screen,
          frame: `${measurementDir}/luma-frames/${name}`, frameSha256: hash(frame),
          screenMaskFile: `${measurementDir}/luma-masks/${name}`, screenMaskSha256: hash(screenMaskBytes),
          noSmokeFrame: `${measurementDir}/luma-no-smoke/${name}`, noSmokeSha256: hash(withoutSmoke) });
        for (const mask of maskPngs) {
          await writeFile(join(maskDir, `${scenario.name}-${mask.name}.png`), Buffer.from(mask.png, 'base64'));
        }
      }
      await cdp.detach();
      assert.deepEqual(errors, []);
      let noLight;
      if (scenario.name === 'night-clear') {
        noLight = await page.evaluate(() => {
          const { scene, renderer, composer } = window.__smokeProbe;
          const smoke = scene.getObjectByName('chimney-smoke');
          const lights = [];
          scene.traverse((object) => { if (object.isLight) lights.push({ object, visible: object.visible }); });
          const fog = scene.fog;
          const wasVisible = smoke.visible;
          const canvas = document.createElement('canvas');
          canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          const snapshot = () => {
            composer.render(0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(renderer.domElement, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          try {
            scene.fog = null;
            for (const light of lights) light.object.visible = false;
            smoke.visible = true;
            const on = snapshot();
            smoke.visible = false;
            const off = snapshot();
            let changed = 0; let brightened = 0; let maxLift = 0;
            for (let i = 0; i < on.length; i += 4) {
              if (on[i] === off[i] && on[i + 1] === off[i + 1] && on[i + 2] === off[i + 2]) continue;
              changed++;
              const lift = 0.2126 * (on[i] - off[i]) + 0.7152 * (on[i + 1] - off[i + 1]) + 0.0722 * (on[i + 2] - off[i + 2]);
              maxLift = Math.max(maxLift, lift);
              if (lift > 0.5) brightened++;
            }
            return { changed, brightened, maxLift };
          } finally {
            smoke.visible = wasVisible;
            scene.fog = fog;
            for (const light of lights) light.object.visible = light.visible;
            composer.render(0);
          }
        });
      }
      report.cases[scenario.name] = { samples, noLight, errors };
      for (const sample of samples) {
        const target = scenario.phase === 'night' ? 70 : 110;
        const exclusive = sample.puffs.filter((puff) => puff.peakExclusiveVoid >= target).length;
        const solo = sample.puffs.filter((puff) => puff.peakSoloVoid >= target).length;
        const contributing = sample.puffs.filter((puff) => puff.brightContributionPixels > 0).length;
        console.log(`${scenario.name} t=${sample.time}: screen mask max ${sample.screenMask.peakLuminance.toFixed(2)}, buffer mask max ${sample.peakSmokeMask.toFixed(2)}, ` +
          `void max ${sample.peakSmokeVoid.toFixed(2)}, >=${target}: ${contributing} contributing / ${exclusive} exclusive / ${solo} solo on void`);
        if (!sample.screenMask.pixels || sample.screenMask.peakLuminance < target) {
          failures.push(`${scenario.name} t=${sample.time}: smoke-mask peak is below ${target}`);
        }
        if (scenario.phase === 'night' && sample.screenMask.peakLuminance >= Math.min(...sample.windows.map((window) => window.luminance))) {
          failures.push(`${scenario.name} t=${sample.time}: smoke is not dimmer than both front windows`);
        }
        if (exclusive < 3 || solo < 3) {
          limitations.push({ case: scenario.name, time: sample.time, target, exclusive, solo });
        }
      }
      if (noLight && (!noLight.changed || noLight.brightened)) failures.push(`${scenario.name}: smoke brightened with lights and fog disabled`);
    } finally { await context.close(); }
  }
  report.failures = failures;
  report.independentVisibilityLimitations = limitations;
  const reportJson = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(output, 'readability.json'), reportJson);
  await writeFile(join(evidenceRoot, measurementDir, 'readability.json'), reportJson);
  assert.deepEqual(failures, [], 'Smoke-mask peak, window or non-emission checks failed');
  console.log(`Smoke-mask peak checks PASS; ${limitations.length} samples have fewer than three exclusive or solo puffs (diagnostic only).`);
} finally { await browser.close(); }

async function measureScreenMask(page, full, withoutSmoke) {
  return page.evaluate(async ({ full, withoutSmoke }) => {
    async function decode(data) {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height);
    }
    const [on, off] = await Promise.all([decode(full), decode(withoutSmoke)]);
    if (on.width !== 1280 || on.height !== 720 || off.width !== on.width || off.height !== on.height) {
      throw new Error('Smoke evidence frames must be 1280×720');
    }
    const mask = new Uint8ClampedArray(on.data.length);
    let pixels = 0; let peakLuminance = 0; let voidPeakLuminance = 0; let bounds = null;
    for (let i = 0; i < on.data.length; i += 4) {
      const changed = on.data[i] !== off.data[i] || on.data[i + 1] !== off.data[i + 1] ||
        on.data[i + 2] !== off.data[i + 2] || on.data[i + 3] !== off.data[i + 3];
      if (changed) {
        const p = i / 4; const x = p % on.width; const y = Math.floor(p / on.width);
        const lum = 0.2126 * on.data[i] + 0.7152 * on.data[i + 1] + 0.0722 * on.data[i + 2];
        pixels++; peakLuminance = Math.max(peakLuminance, lum);
        if (off.data[i] === 16 && off.data[i + 1] === 20 && off.data[i + 2] === 22) {
          voidPeakLuminance = Math.max(voidPeakLuminance, lum);
        }
        if (!bounds) bounds = [x, y, x + 1, y + 1];
        else {
          bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
          bounds[2] = Math.max(bounds[2], x + 1); bounds[3] = Math.max(bounds[3], y + 1);
        }
        mask[i] = mask[i + 1] = mask[i + 2] = 255;
      }
      mask[i + 3] = 255;
    }
    const canvas = document.createElement('canvas'); canvas.width = on.width; canvas.height = on.height;
    canvas.getContext('2d').putImageData(new ImageData(mask, on.width, on.height), 0, 0);
    return { pixels, bounds, peakLuminance, voidPeakLuminance, png: canvas.toDataURL('image/png').split(',')[1] };
  }, { full: full.toString('base64'), withoutSmoke: withoutSmoke.toString('base64') });
}
