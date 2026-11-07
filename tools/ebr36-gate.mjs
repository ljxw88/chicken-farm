import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Record from the requested clean commit, never a different worktree. Match
// tools/parity.mjs: seed rain at construction and step the renderer ourselves.
const baselineSha = process.env.EBR36_BASELINE_SHA ?? '4799b8e4fe57dfede5b567a8517be523ff575f4f';
const seed = Number(process.env.EBR36_SEED ?? 0xeb730001);
if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('EBR36_SEED must be a 32-bit unsigned integer');
if (!process.env.EBR36_GATE_DIR) throw new Error('Set EBR36_GATE_DIR to an evidence directory outside the worktree');
const output = resolve(process.env.EBR36_GATE_DIR);
const phases = ['morning', 'daytime', 'sunset', 'night'];
const weatherModes = ['clear', 'rain', 'cloudy'];
const viewports = [
  { width: 1280, height: 720 }, { width: 1260, height: 1080 },
  { width: 390, height: 844, touch: true }, { width: 320, height: 568, touch: true },
  { width: 844, height: 390, touch: true }, { width: 700, height: 844, touch: true },
  { width: 700, height: 390, touch: true },
  { width: 480, height: 320, touch: true }, { width: 568, height: 320, touch: true },
  { width: 320, height: 320, touch: true }, { width: 340, height: 320, touch: true },
  { width: 390, height: 320, touch: true }, { width: 700, height: 320, touch: true },
  { width: 480, height: 390, touch: true }, { width: 568, height: 500, touch: true },
  { width: 700, height: 460, touch: true },
];
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
let temp;
try {
  temp = await mkdtemp('/tmp/opencode/ebr36-baseline-');
} catch (error) {
  if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
  temp = await mkdtemp(join(tmpdir(), 'ebr36-baseline-'));
}
let baselineServer;
let candidateServer;
let browser;

async function serve(root) {
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function save(path, bytes) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, bytes);
}

function rectangles(boxes, viewport) {
  // The surface's 36px shadow blur and 12px vertical offset are included.
  const shadow = 64;
  return boxes.map(({ x, y, width, height }) => {
    const left = Math.max(0, Math.floor(x - shadow));
    const top = Math.max(0, Math.floor(y - shadow));
    const right = Math.min(viewport.width, Math.ceil(x + width + shadow));
    const bottom = Math.min(viewport.height, Math.ceil(y + height + shadow));
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

async function screenshot(context, page) {
  const cdp = await context.newCDPSession(page);
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await cdp.detach();
  return Buffer.from(result.data, 'base64');
}

async function capture(url, viewport, phase, weather, candidate, hideSky = false) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1, reducedMotion: 'reduce', isMobile: Boolean(viewport.touch), hasTouch: Boolean(viewport.touch) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // Clean main has no favicon; the candidate supplies one and must be quiet.
    if (message.type() === 'error' && (candidate || !message.location().url.endsWith('/favicon.ico'))) errors.push(message.text());
  });
  try {
    await page.addInitScript(({ seed }) => {
      let state = seed >>> 0;
      window.__ebr36RandomCalls = 0;
      window.__ebr36Random = () => {
        window.__ebr36RandomCalls++;
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__ebr36Step = (time) => {
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
      await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr36Random,')}\nwindow.__ebr36Gate = { scene, camera, character, dayNight, renderer, composer };\n` });
    });
    await page.goto(`${url}/?phase=${phase}&weather=${weather}${hideSky ? '&skyhud=0' : ''}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__ebr36Gate));
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { for (let i = 0; i <= 25; i++) window.__ebr36Step(i * 100); });
    const state = await page.evaluate(() => {
      const { scene, camera, character, dayNight } = window.__ebr36Gate;
      const key = scene.getObjectByName('day-night-directional');
      const hemi = scene.getObjectByName('day-night-hemisphere');
      return { phase: dayNight.getPhase(), weather: window.getWeather(), randomCalls: window.__ebr36RandomCalls,
        position: character.position.toArray(), camera: camera.position.toArray(), keyPosition: key.position.toArray(),
        keyIntensity: key.intensity, hemisphere: hemi.color.toArray(), pixel: window.getPixelRendering() };
    });
    assert.ok(state.randomCalls > 0);
    assert.equal(state.phase, phase);
    assert.equal(state.weather.mode, weather);
    const placementBox = await page.locator('.placement-controls').evaluate((element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    let open = await screenshot(context, page);
    let closed;
    let openBoxes;
    let closedBoxes;
    let openPlacementBox;
    if (candidate && !hideSky) {
      assert.equal(await page.locator('#sky-panel').isHidden(), true);
      closed = open;
      closedBoxes = [await page.locator('.hud-toolbar').evaluate((element) => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })];
      await page.evaluate(() => document.querySelector('[data-action="sky"]').click());
      assert.equal(await page.locator('#sky-panel').isVisible(), true);
      openBoxes = await page.evaluate(() => ['#sky-panel', '.hud-toolbar'].map((selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }));
      openPlacementBox = await page.locator('.placement-controls').evaluate((element) => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      open = await screenshot(context, page);
    } else if (hideSky) {
      assert.equal(await page.locator('#hud, #sky-panel, .hud-toolbar').count(), 0);
    }
    assert.deepEqual(errors, []);
    return { open, closed, state, openBoxes, closedBoxes, placementBox, openPlacementBox, errors };
  } finally {
    await context.close();
  }
}

async function compare(page, reference, actual, rects) {
  return page.evaluate(async ({ before, after, rects }) => {
    async function decode(data) {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    }
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
    const diff = context.createImageData(a.width, a.height);
    let changed = 0;
    let outside = 0;
    let minX = a.width, minY = a.height, maxX = -1, maxY = -1;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        const i = (y * a.width + x) * 4;
        if (original.data[i] === current.data[i] && original.data[i + 1] === current.data[i + 1] &&
            original.data[i + 2] === current.data[i + 2] && original.data[i + 3] === current.data[i + 3]) continue;
        changed++;
        const masked = rects.some((r) => x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height);
        if (!masked) {
          outside++;
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        diff.data[i] = masked ? 128 : 255;
        diff.data[i + 2] = masked ? 255 : 0;
        diff.data[i + 3] = 255;
      }
    }
    context.putImageData(diff, 0, 0);
    const diffPng = canvas.toDataURL('image/png').split(',')[1];
    context.fillStyle = '#000';
    context.fillRect(0, 0, a.width, a.height);
    context.fillStyle = '#fff';
    for (const r of rects) context.fillRect(r.x, r.y, r.width, r.height);
    const maskPng = canvas.toDataURL('image/png').split(',')[1];
    return { changed, outside, outsideBounds: outside ? { minX, minY, maxX, maxY } : null, diffPng, maskPng };
  }, { before: reference.toString('base64'), after: actual.toString('base64'), rects });
}

try {
  assert.equal(execFileSync('git', ['rev-parse', `${baselineSha}^{commit}`], { encoding: 'utf8' }).trim(), baselineSha);
  const archive = join(temp, 'main.tar');
  const baselineRoot = join(temp, 'main');
  await mkdir(baselineRoot);
  execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, baselineSha, 'index.html', 'package.json', 'src']);
  execFileSync('tar', ['-xf', archive, '-C', baselineRoot]);
  await symlink(resolve('node_modules'), join(baselineRoot, 'node_modules'), 'dir');
  const baseline = await serve(baselineRoot);
  baselineServer = baseline.server;
  const candidate = await serve(process.cwd());
  candidateServer = candidate.server;
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
  const diffPage = await browser.newPage();
  const results = [];
  for (const viewport of viewports) {
    const size = `${viewport.width}x${viewport.height}`;
    for (const phase of viewport.touch ? ['morning'] : phases) {
      for (const weather of viewport.touch ? ['clear'] : weatherModes) {
        const name = `${phase}-${weather}`;
        const before = await capture(baseline.url, viewport, phase, weather, false);
        const after = await capture(candidate.url, viewport, phase, weather, true);
        const hidden = await capture(candidate.url, viewport, phase, weather, true, true);
        const stateMatches = isDeepStrictEqual(before.state, after.state) && isDeepStrictEqual(before.state, hidden.state);
        await save(join(output, 'before', size, `${name}.png`), before.open);
        const variants = {};
        for (const variant of ['open', 'closed', 'hidden']) {
          const image = variant === 'hidden' ? hidden.open : after[variant];
          const boxes = variant === 'hidden' ? [] : [...after[`${variant}Boxes`]];
          const placement = variant === 'open' ? after.openPlacementBox : after.placementBox;
          if (variant !== 'hidden' && !isDeepStrictEqual(before.placementBox, placement)) boxes.push(before.placementBox, placement);
          const rects = rectangles(boxes, viewport);
          const result = await compare(diffPage, before.open, image, rects);
          await save(join(output, variant, size, `${name}.png`), image);
          await save(join(output, 'mask', size, `${name}-${variant}.png`), Buffer.from(result.maskPng, 'base64'));
          await save(join(output, 'diff', size, `${name}-${variant}.png`), Buffer.from(result.diffPng, 'base64'));
          variants[variant] = { rectangles: rects, changedPixels: result.changed, outsideMaskPixels: result.outside,
            outsideBounds: result.outsideBounds, sha256: sha256(image) };
        }
        results.push({ viewport: size, phase, weather, stateMatches, state: after.state, beforeSha256: sha256(before.open), variants });
        console.log(`${size} ${name}: state=${stateMatches} outside-mask open=${variants.open.outsideMaskPixels} closed=${variants.closed.outsideMaskPixels} hidden=${variants.hidden.outsideMaskPixels}`);
      }
    }
  }
  await diffPage.close();
  const candidateSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceStatus = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--',
    'src', 'index.html', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim();
  const report = { baselineSha, candidateSha, candidateSource: 'working tree', sourceStatus, browser: browser.version(), seed,
    seedMethod: 'tools/parity.mjs-style seeded weather random injection', shadowMaskPaddingPx: 64, results };
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'gate-g.json'), `${JSON.stringify(report, null, 2)}\n`);
  assert.ok(results.every(({ stateMatches, variants }) => stateMatches && Object.values(variants).every((variant) => variant.outsideMaskPixels === 0)),
    'Gate G: state or pixels outside the declared HUD/shadow mask differ');
} finally {
  await browser?.close();
  await baselineServer?.close();
  await candidateServer?.close();
  await rm(temp, { recursive: true });
}
