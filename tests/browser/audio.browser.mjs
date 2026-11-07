import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { after, before, test } from 'node:test';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { verifyBaselineArchive } from '../../tools/baseline-archive.mjs';

const viewport = { width: 1280, height: 720 };
const evidenceDir = process.env.EBR38_EVIDENCE_DIR && resolve(process.env.EBR38_EVIDENCE_DIR);
const baselineRoot = process.env.EBR38_BASELINE_ROOT && resolve(process.env.EBR38_BASELINE_ROOT);
const baselineSha = process.env.EBR38_BASELINE_SHA;
let server, baselineServer, browser, url, baselineUrl;

async function portIsFree(port) {
  const probe = createNetServer();
  return new Promise((done, fail) => {
    probe.once('error', (error) => error.code === 'EADDRINUSE' ? done(false) : fail(error));
    probe.listen({ host: '0.0.0.0', port, exclusive: true }, () => probe.close(() => done(true)));
  });
}

async function serve(root) {
  for (let port = 5211; port <= 5229; port++) {
    if (!await portIsFree(port)) continue;
    const attempt = await createServer({ root, configFile: false, logLevel: 'silent',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try {
      await attempt.listen();
      return { server: attempt, url: `http://127.0.0.1:${port}` };
    } catch (error) {
      await attempt.close();
      if (error.code !== 'EADDRINUSE' && error.message !== `Port ${port} is already in use`) throw error;
    }
  }
  throw new Error('No free port in 5211–5229');
}

before(async () => {
  if (evidenceDir) {
    const fromRoot = relative(process.cwd(), evidenceDir);
    assert.ok(fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot),
      'Audio evidence must be outside the worktree');
    await mkdir(evidenceDir, { recursive: true });
  }
  ({ server, url } = await serve(process.cwd()));
  if (baselineRoot) {
    assert.ok(baselineSha, 'EBR38_BASELINE_SHA is required with EBR38_BASELINE_ROOT');
    await verifyBaselineArchive(baselineRoot, baselineSha);
    const baseline = await serve(baselineRoot);
    baselineServer = baseline.server;
    baselineUrl = baseline.url;
  }
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
});

after(async () => {
  await browser?.close();
  await baselineServer?.close();
  await server?.close();
});

async function openPage(t, { unsupported = false, blocked = false, frozen = false, mobile = false,
  baseline = false, monitor = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : viewport,
    deviceScaleFactor: 1, reducedMotion: 'reduce', isMobile: mobile, hasTouch: mobile });
  t.after(() => context.close());
  if (unsupported) await context.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined });
  });
  if (blocked) await context.addInitScript(() => {
    window.__resumeAttempts = 0;
    window.AudioContext = class {
      state = 'suspended';
      resume() {
        window.__resumeAttempts++;
        if (window.__resumeAttempts === 1) return Promise.reject(new Error('autoplay blocked'));
        this.state = 'running';
        return Promise.resolve();
      }
      close() { this.state = 'closed'; return Promise.resolve(); }
    };
  });
  if (monitor) await context.addInitScript(() => {
    window.__audioActivity = { contexts: 0, sources: 0, mediaPlays: 0 };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.__audioActivity.contexts++; }
      createBufferSource(...args) { window.__audioActivity.sources++; return super.createBufferSource(...args); }
      createOscillator(...args) { window.__audioActivity.sources++; return super.createOscillator(...args); }
      createMediaElementSource(...args) { window.__audioActivity.sources++; return super.createMediaElementSource(...args); }
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) { window.__audioActivity.mediaPlays++; return play.apply(this, args); };
  });
  if (frozen) await context.addInitScript(() => {
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr38Step = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame scheduled');
      for (const callback of current) callback(time);
    };
  });
  const page = await context.newPage();
  const errors = [], audioRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('request', (request) => {
    if (/\.(ogg|mp3|wav|m4a)(?:[?#]|$)/i.test(request.url())) audioRequests.push(request.url());
  });
  if (!baseline) await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr38Test = { character, engine, audio };\n` });
  });
  await page.goto(`${baseline ? baselineUrl : url}/?phase=daytime&weather=clear&seed=123`, { waitUntil: 'networkidle' });
  if (!baseline) await page.waitForFunction(() => Boolean(window.__ebr38Test), null, { polling: 50 });
  if (frozen) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { for (let i = 0; i <= 25; i++) window.__ebr38Step(i * 100); });
  }
  return { context, page, errors, audioRequests };
}

async function state(page, expected) {
  await page.waitForFunction((value) => document.querySelector('[data-action="sound"]')?.dataset.audioState === value,
    expected, { polling: 50, timeout: 5000 });
}

async function assertQuiet(opened) {
  assert.deepEqual(opened.errors, []);
  assert.deepEqual(opened.audioRequests, []);
}

async function missingAssets(page) {
  await page.evaluate(() => {
    window.__ebr38Test.audio.playNature('/missing/nature.ogg');
    window.__ebr38Test.audio.playMusic('/missing/music.mp3');
  });
}

test('speaker toggles with pointer and keyboard without moving or placing', { timeout: 60000 }, async (t) => {
  const opened = await openPage(t, { monitor: true });
  const { page } = opened;
  const sound = page.locator('[data-action="sound"]');
  const before = await page.evaluate(() => window.__ebr38Test.character.position.toArray());
  assert.equal(await sound.isEnabled(), true);
  assert.equal(await sound.getAttribute('data-audio-state'), 'locked');
  assert.equal(await sound.getAttribute('aria-label'), 'Sound off, activate to enable');
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  assert.equal(await sound.getAttribute('title'), 'Turn sound on');
  assert.equal(await sound.evaluate((node) => getComputedStyle(node).opacity), '0.45');
  const waveIcon = await sound.innerHTML();
  await missingAssets(page);
  assert.deepEqual(await page.evaluate(() => window.__audioActivity), { contexts: 0, sources: 0, mediaPlays: 0 });

  await sound.click();
  await state(page, 'on');
  await missingAssets(page);
  assert.equal(await sound.getAttribute('aria-label'), 'Sound on');
  assert.equal(await sound.getAttribute('aria-pressed'), 'true');
  assert.equal(await sound.getAttribute('title'), 'Mute sound');
  assert.equal(await sound.innerHTML(), waveIcon);
  assert.equal(await sound.evaluate((node) => getComputedStyle(node).borderRadius), '999px');
  assert.notEqual(await sound.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');

  await sound.focus();
  await page.keyboard.press('Space');
  await state(page, 'muted');
  await missingAssets(page);
  assert.equal(await sound.getAttribute('aria-label'), 'Sound muted');
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  assert.equal(await sound.getAttribute('title'), 'Turn sound on');
  assert.notEqual(await sound.innerHTML(), waveIcon);
  assert.equal(await sound.evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('Enter');
  await state(page, 'on');
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  await page.keyboard.press('f');
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => window.__ebr38Test.character.position.toArray()), before);
  assert.equal(await page.locator('.placement-controls').evaluate((node) => node.classList.contains('is-active')), false);
  assert.deepEqual(await page.evaluate(() => window.__audioActivity), { contexts: 1, sources: 0, mediaPlays: 0 });
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await sound.getAttribute('data-audio-state'), 'locked', 'sound does not persist across reloads');
  await assertQuiet(opened);
});

test('unsupported audio is genuinely disabled and does not affect other controls', { timeout: 60000 }, async (t) => {
  const opened = await openPage(t, { unsupported: true });
  const { page } = opened;
  const sound = page.locator('[data-action="sound"]');
  assert.equal(await sound.isDisabled(), true);
  assert.equal(await sound.getAttribute('data-audio-state'), 'unavailable');
  assert.equal(await sound.getAttribute('aria-label'), 'Sound unavailable');
  assert.equal(await sound.getAttribute('aria-disabled'), 'true');
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');
  assert.equal(await sound.getAttribute('title'), 'Not available yet');
  await missingAssets(page);
  await page.locator('[data-action="sky"]').click();
  assert.equal(await page.locator('#sky-panel').isVisible(), true);
  await assertQuiet(opened);
});

test('a blocked activation remains dim and retryable without console errors', { timeout: 60000 }, async (t) => {
  const opened = await openPage(t, { blocked: true });
  const { page } = opened;
  const sound = page.locator('[data-action="sound"]');
  await sound.click();
  assert.equal(await page.evaluate(() => window.__resumeAttempts), 1);
  assert.equal(await sound.getAttribute('data-audio-state'), 'locked');
  assert.equal(await sound.getAttribute('title'), 'Turn sound on');
  assert.equal(await sound.isEnabled(), true);
  await sound.click();
  await state(page, 'on');
  assert.equal(await page.evaluate(() => window.__resumeAttempts), 2);
  await assertQuiet(opened);
});

test('touch toggles the speaker without moving the chicken', { timeout: 60000 }, async (t) => {
  const opened = await openPage(t, { mobile: true });
  const { page } = opened;
  const sound = page.locator('[data-action="sound"]');
  const before = await page.evaluate(() => window.__ebr38Test.character.position.toArray());
  await sound.tap();
  await state(page, 'on');
  await sound.tap();
  await state(page, 'muted');
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.__ebr38Test.character.position.toArray()), before);
  await assertQuiet(opened);
});

async function screenshot(opened) {
  const cdp = await opened.context.newCDPSession(opened.page);
  try {
    return Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true })).data, 'base64');
  } finally { await cdp.detach(); }
}

async function crop(page, bytes, box) {
  const png = await page.evaluate(async ({ imageData, box }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${imageData}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = box.width; canvas.height = box.height;
    canvas.getContext('2d').drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { imageData: bytes.toString('base64'), box });
  return Buffer.from(png, 'base64');
}

async function compare(page, reference, candidate, box) {
  return page.evaluate(async ({ before, after, box }) => {
    const decode = async (data) => {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image;
    };
    const [a, b] = await Promise.all([decode(before), decode(after)]);
    if (a.width !== b.width || a.height !== b.height) throw new Error('Frame dimensions differ');
    const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(a, 0, 0);
    const first = ctx.getImageData(0, 0, a.width, a.height).data;
    ctx.clearRect(0, 0, a.width, a.height);
    ctx.drawImage(b, 0, 0);
    const second = ctx.getImageData(0, 0, a.width, a.height).data;
    let changed = 0, outside = 0;
    for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (first[i] === second[i] && first[i + 1] === second[i + 1] &&
          first[i + 2] === second[i + 2] && first[i + 3] === second[i + 3]) continue;
      changed++;
      if (x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height) outside++;
    }
    return { changed, outside, width: a.width, height: a.height };
  }, { before: reference.toString('base64'), after: candidate.toString('base64'), box });
}

test('seed 123 state frames change only inside the speaker button', { timeout: 90000 }, async (t) => {
  const opened = await openPage(t, { frozen: true });
  const { page } = opened;
  const rectangle = (selector) => page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const x = Math.floor(rect.left), y = Math.floor(rect.top);
    return { x, y, width: Math.ceil(rect.right) - x, height: Math.ceil(rect.bottom) - y };
  });
  const toolbar = await rectangle('.hud-toolbar');
  const speaker = await rectangle('[data-action="sound"]');
  assert.ok(speaker.x >= toolbar.x && speaker.y >= toolbar.y &&
    speaker.x + speaker.width <= toolbar.x + toolbar.width && speaker.y + speaker.height <= toolbar.y + toolbar.height);
  const locked = await screenshot(opened);
  const click = async () => {
    await page.mouse.click(speaker.x + speaker.width / 2, speaker.y + speaker.height / 2);
    await page.mouse.move(0, 0);
  };
  await click();
  await state(page, 'on');
  const on = await screenshot(opened);
  await click();
  await state(page, 'muted');
  const muted = await screenshot(opened);

  const unsupported = await openPage(t, { unsupported: true, frozen: true });
  assert.equal(await unsupported.page.locator('[data-action="sound"]').isDisabled(), true);
  const disabled = await screenshot(unsupported);
  const results = {
    lockedVsDisabled: await compare(page, locked, disabled, speaker),
    lockedVsOn: await compare(page, locked, on, speaker),
    lockedVsMuted: await compare(page, locked, muted, speaker),
  };
  assert.equal(results.lockedVsDisabled.changed, 0, 'locked and disabled have the same dim appearance');
  for (const name of ['lockedVsOn', 'lockedVsMuted']) {
    assert.ok(results[name].changed > 0, `${name} must visibly change`);
    assert.equal(results[name].outside, 0, `${name} changed pixels outside the speaker`);
  }

  let baseline;
  if (baselineUrl) {
    const main = await openPage(t, { frozen: true, baseline: true });
    baseline = await screenshot(main);
    results.mainVsDisabled = await compare(page, baseline, disabled, speaker);
    results.mainVsOn = await compare(page, baseline, on, speaker);
    results.mainVsMuted = await compare(page, baseline, muted, speaker);
    assert.equal(results.mainVsDisabled.changed, 0, 'untouched speaker must match clean main exactly');
    assert.ok(results.mainVsOn.changed > 0 && results.mainVsMuted.changed > 0);
    for (const name of ['mainVsDisabled', 'mainVsOn', 'mainVsMuted']) {
      assert.equal(results[name].outside, 0, `${name} changed pixels outside the speaker`);
    }
    await assertQuiet(main);
  }
  await assertQuiet(opened);
  await assertQuiet(unsupported);

  if (evidenceDir) {
    const frames = { disabled, on, muted };
    const hashes = {};
    for (const [name, bytes] of Object.entries(frames)) {
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [viewport.width, viewport.height]);
      await writeFile(join(evidenceDir, `speaker-${name}-1280x720.png`), bytes);
      await writeFile(join(evidenceDir, `speaker-${name}-crop.png`), await crop(page, bytes, speaker));
      await writeFile(join(evidenceDir, `toolbar-${name}-crop.png`), await crop(page, bytes, toolbar));
      hashes[name] = createHash('sha256').update(bytes).digest('hex');
    }
    if (baseline) await writeFile(join(evidenceDir, 'clean-main-1280x720.png'), baseline);
    await writeFile(join(evidenceDir, 'speaker-proof.json'), `${JSON.stringify({
      head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), baselineSha: baselineSha ?? null,
      browser: browser.version(), seed: 123, viewport, phase: 'daytime', weather: 'clear',
      frameTimesMs: { first: 0, last: 2500, interval: 100 }, candidateUrl: url, baselineUrl: baselineUrl ?? null,
      toolbar, speaker, frames: hashes, results, errors: [...opened.errors, ...unsupported.errors],
    }, null, 2)}\n`);
  }
});
