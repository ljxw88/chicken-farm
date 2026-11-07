import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildSingleHtml } from '../../tools/export-single-html.mjs';
import { compareParityFrames } from '../../tools/parity-diff.mjs';

const viewport = { width: 390, height: 844 };
// Ground points projected at the unmodified 390x844 spawn camera.
const placementPoint = { x: 105.02, y: 523.65 };
const walkPoint = { x: 195, y: 506.42 };
const query = '?phase=daytime&weather=clear&seed=123';
let browser;
let server;
let directory;
let file;
let fileUrl;
let httpUrl;

before(async () => {
  const html = await buildSingleHtml();
  try {
    directory = await mkdtemp('/tmp/opencode/ebr78-export-');
  } catch (error) {
    if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
    directory = await mkdtemp(join(tmpdir(), 'ebr78-export-'));
  }
  file = join(directory, 'chicken-farm.html');
  await writeFile(file, html);
  fileUrl = `${pathToFileURL(file).href}${query}`;

  server = createServer((request, response) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/chicken-farm.html') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(html);
  });
  const port = Number(process.env.EBR78_PORT || 5251);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
  httpUrl = `http://${process.env.EBR78_LAN_HOST || '127.0.0.1'}:${port}/chicken-farm.html${query}`;
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
});

after(async () => {
  await browser?.close();
  if (server?.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (file) await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  if (directory) await rmdir(directory);
});

async function openControlled(url) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  if (url.startsWith('file:')) await context.setOffline(true);
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async (route) => {
    if (route.request().url() === url) await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__exportStep = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame scheduled');
      for (const callback of current) callback(time);
    };
  });
  await page.goto(url, { waitUntil: 'load' });
  assert.ok(await page.evaluate(() => Boolean(window.getPixelRendering?.().canvasWidth)), 'Game did not initialize');
  await page.evaluate(() => window.__exportStep(0));
  return { context, page, requests, errors };
}

function assertOfflinePage({ requests, errors }, url) {
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [url], 'The document must not request any additional files or URLs');
}

async function tapControl(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${selector} must be visible`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assert.equal(await page.evaluate(({ x, y, selector }) => Boolean(document.elementFromPoint(x, y)?.closest(selector)),
    { ...point, selector }), true, `${selector} must be tappable`);
  await page.touchscreen.tap(point.x, point.y);
}

async function screenshot(page, clip) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, ...(clip ? { clip } : {}) });
    return Buffer.from(result.data, 'base64');
  } finally {
    await cdp.detach();
  }
}

async function changedPixels(reference, candidate) {
  const page = await browser.newPage();
  try {
    return (await page.evaluate(compareParityFrames, {
      reference: reference.toString('base64'), candidate: candidate.toString('base64'),
    })).changedPixels;
  } finally {
    await page.close();
  }
}

test('the same HTML bytes are served over HTTP without extra resources', { timeout: 60000 }, async () => {
  const response = await fetch(httpUrl);
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(file));
});

test('offline file and HTTP touch preview, rotate, place and remove', { timeout: 90000 }, async () => {
  for (const url of [fileUrl, httpUrl]) {
    const run = await openControlled(url);
    try {
      const { page } = run;
      await tapControl(page, '[data-fence]');
      assert.equal(await page.locator('[data-fence]').getAttribute('aria-pressed'), 'true');
      assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, placementPoint), 'scene');
      await page.touchscreen.tap(placementPoint.x, placementPoint.y);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      assert.equal(await page.locator('[data-undo]').isEnabled(), false, 'A tap only previews');
      await page.evaluate(() => window.__exportStep(0));
      const clip = { x: 50, y: 450, width: 120, height: 110, scale: 1 };
      const beforeRotate = await screenshot(page, clip);
      await tapControl(page, '[data-rotate]');
      await page.evaluate(() => window.__exportStep(0));
      const afterRotate = await screenshot(page, clip);
      assert.ok(await changedPixels(beforeRotate, afterRotate) > 0, 'Rotate should visibly change the preview');
      await tapControl(page, '[data-confirm]');
      assert.match(await page.locator('.placement-status').textContent(), /Space already occupied/);
      assert.equal(await page.locator('[data-undo]').isEnabled(), true);
      await tapControl(page, '[data-remove]');
      await page.touchscreen.tap(placementPoint.x, placementPoint.y);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      assert.equal(await page.locator('[data-undo]').isEnabled(), false);
      assertOfflinePage(run, url);
    } finally {
      await run.context.close();
    }
  }
});

test('touch-to-walk changes the same deterministic scene from file and HTTP', { timeout: 90000 }, async () => {
  async function frame(url, tap) {
    const run = await openControlled(url);
    try {
      if (tap) {
        assert.equal(await run.page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, walkPoint), 'scene');
        await run.page.touchscreen.tap(walkPoint.x, walkPoint.y);
      }
      await run.page.evaluate(() => { for (let i = 1; i <= 10; i++) window.__exportStep(i * 100); });
      const frame = await screenshot(run.page);
      assertOfflinePage(run, url);
      return frame;
    } finally {
      await run.context.close();
    }
  }
  const idle = await frame(fileUrl, false);
  const localWalk = await frame(fileUrl, true);
  const servedWalk = await frame(httpUrl, true);
  assert.ok(await changedPixels(idle, localWalk) > 1000, 'A ground tap must move the visible scene');
  assert.equal(await changedPixels(localWalk, servedWalk), 0, 'File and HTTP touch walking must match');
});
