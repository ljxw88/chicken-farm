import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const evidenceDir = process.env.EBR55_EVIDENCE_DIR;
const proof = {};
let devServer;
let previewServer;
let browser;
let devUrl;
let previewUrl;

function serverUrl(server) {
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  devServer = await createServer({
    configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await devServer.listen();
  devUrl = serverUrl(devServer.httpServer);
  previewServer = await preview({ configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  previewUrl = serverUrl(previewServer.httpServer);
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  if (evidenceDir) await writeFile(join(evidenceDir, 'proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await devServer?.close();
  if (previewServer) await new Promise((resolve) => previewServer.httpServer.close(resolve));
});

async function openPage(context, url, instrument = false) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  if (instrument) {
    // Test-only access to the actual scene for projection and position checks;
    // the production app gets no test or teleport globals.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = `${await response.text()}\nwindow.__ebr55Test = { scene, camera, character };\n`;
      await route.fulfill({ response, body });
    });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  if (instrument) await page.waitForFunction(() => Boolean(window.__ebr55Test));
  await page.evaluate(() => { window.setDayNightCycleSeconds(36000); window.setDayNightPhase('daytime'); });
  return { page, errors };
}

async function capture(page, name) {
  if (evidenceDir) await page.screenshot({ path: join(evidenceDir, name) });
}

async function worldPoint(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__ebr55Test;
    camera.updateMatrixWorld();
    const projected = character.position.clone().set(x, character.position.y, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (projected.x + 1) * rect.width / 2, y: rect.top + (1 - projected.y) * rect.height / 2 };
  }, { x, z });
}

async function chickenPoint(page) {
  return page.evaluate(() => {
    const { scene, camera, character } = window.__ebr55Test;
    const chicken = scene.getObjectByName('qa-chicken-stub');
    const point = chicken.getWorldPosition(character.position.clone());
    point.y += 0.45;
    camera.updateMatrixWorld();
    point.project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
}

async function position(page) {
  return page.evaluate(() => window.__ebr55Test.character.position.toArray());
}

async function waitForMessage(page, text) {
  await page.waitForFunction((expected) => document.querySelector('[role="status"]').textContent.includes(expected), text);
}

test('production: approach chicken, press E once, then click the egg prompt to collect', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, previewUrl);
  const chicken = page.locator('.interaction-prompt[data-interactable="qa-chicken"]');
  const egg = page.locator('.interaction-prompt[data-interactable="qa-egg"]');
  const status = page.locator('[role="status"]');
  const webgl = await page.evaluate(() => {
    const context = document.querySelector('#scene').getContext('webgl2');
    return context?.getParameter(context.VERSION);
  });
  assert.match(webgl, /WebGL 2\.0/);
  const pixel = await page.evaluate(() => window.getPixelRendering());
  assert.equal(pixel.enabled, true);
  assert.deepEqual([pixel.canvasWidth, pixel.canvasHeight], [320, 180]);
  await page.evaluate(() => window.setWeather('rain'));
  assert.equal(await page.locator('.interaction-prompt').isVisible(), false);

  await page.keyboard.down('s');
  await chicken.waitFor({ state: 'visible', timeout: 10000 });
  await page.keyboard.up('s');
  assert.equal(await chicken.evaluate((element) => getComputedStyle(element).imageRendering), 'auto');
  assert.equal(await status.textContent(), ''); // Entering the range is not an action.
  await capture(page, '01-chicken-prompt.png');

  await page.keyboard.down('e');
  await waitForMessage(page, 'Fed chicken');
  await page.keyboard.down('e'); // OS key repeat cannot use a second feed.
  await page.waitForTimeout(150);
  assert.match(await status.textContent(), /Fed chicken \(QA stub\)\. Feed: 0/);
  await page.keyboard.up('e');
  await capture(page, '02-fed.png');

  // S+D moves along world +X; camera and screen-relative WASD are unchanged.
  await page.keyboard.down('s');
  await page.keyboard.down('d');
  await egg.waitFor({ state: 'visible', timeout: 10000 });
  await page.keyboard.up('s');
  await page.keyboard.up('d');
  await capture(page, '03-egg-prompt.png');
  await egg.click();
  await waitForMessage(page, 'Collected egg');
  assert.match(await status.textContent(), /Eggs: 1/);
  assert.equal(await egg.isVisible(), false);
  await capture(page, '04-egg-collected.png');
  assert.deepEqual(errors, []);
  proof.production = {
    browser: `Chromium ${browser.version()}`, webgl, viewport: '1280x720', approachedWith: 'S',
    fedWith: 'E', collectedWith: 'prompt click', repeatedKeyDidNotFeed: true, errors,
  };
});

test('walking through a proximity area on a ground destination never activates it', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  const heights = await page.evaluate(() => {
    const { scene, character } = window.__ebr55Test;
    const y = (name) => scene.getObjectByName(name).getWorldPosition(character.position.clone()).y;
    return ['island-top', 'qa-chicken-stub', 'qa-egg-stub', 'qa-sign-stub', 'qa-feed-bin-stub'].map(y);
  });
  assert.deepEqual(heights, [2.4, 2.4, 2.4, 2.4, 2.4]);
  const destination = await worldPoint(page, 3.5, 3.5);
  await page.mouse.click(destination.x, destination.y);
  await page.locator('.interaction-prompt[data-interactable="qa-chicken"]').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('[role="status"]').textContent(), '');
  await capture(page, '05-crossing-prompt.png');
  await page.waitForFunction(() => window.__ebr55Test.character.position.x > 3.25, null, { timeout: 10000 });
  assert.equal(await page.locator('[role="status"]').textContent(), '');
  assert.equal(await page.locator('.interaction-prompt[data-interactable="qa-chicken"]').isVisible(), false);
  const end = await position(page);
  assert.deepEqual(errors, []);
  proof.crossing = { groundDestination: [3.5, 3.5], end, sawPrompt: true, automaticActions: 0, errors };
});

test('clicking an out-of-range chicken only walks; an in-range object click feeds it', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  const first = await chickenPoint(page);
  await page.mouse.click(first.x, first.y);
  await page.locator('.interaction-prompt[data-interactable="qa-chicken"]').waitFor({ state: 'visible', timeout: 10000 });
  assert.equal(await page.locator('[role="status"]').textContent(), '');
  const second = await chickenPoint(page);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, second), 'scene');
  await page.mouse.click(second.x, second.y);
  await waitForMessage(page, 'Fed chicken');
  const stopped = await position(page);
  await page.waitForTimeout(400);
  const later = await position(page);
  assert.ok(Math.hypot(stopped[0] - later[0], stopped[2] - later[2]) < 0.03);
  await capture(page, '06-object-click-fed.png');
  assert.deepEqual(errors, []);
  proof.objectClick = { outOfRangeOnlyWalked: true, inRangeFed: true, stopped, later, errors };
});

test('sign and bin expose their stub actions and only the supplied signed rates', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  const sign = page.locator('.interaction-prompt[data-interactable="qa-sign"]');
  const bin = page.locator('.interaction-prompt[data-interactable="qa-feed-bin"]');
  const status = page.locator('[role="status"]');
  const signDestination = await worldPoint(page, 0.4, -1.5);
  await page.mouse.click(signDestination.x, signDestination.y);
  await sign.waitFor({ state: 'visible', timeout: 10000 });
  await page.keyboard.press('e');
  await waitForMessage(page, 'egg sale +3 coins');
  assert.match(await status.textContent(), /feed purchase -1 coin/);
  assert.match(await status.textContent(), /Trading is not connected/);
  await capture(page, '07-sign.png');

  const destination = await worldPoint(page, -2.3, -0.85);
  await page.mouse.click(destination.x, destination.y);
  await bin.waitFor({ state: 'visible', timeout: 10000 });
  assert.match(await bin.textContent(), /Open feed bin/);
  await page.keyboard.press('e');
  await waitForMessage(page, 'Opened feed bin');
  assert.match(await bin.textContent(), /Close feed bin/);
  await capture(page, '08-open-bin.png');
  await page.keyboard.press('e');
  await waitForMessage(page, 'Closed feed bin');
  assert.match(await bin.textContent(), /Open feed bin/);
  assert.deepEqual(errors, []);
  proof.contextActions = { sign: 'egg sale +3; feed purchase -1; no transaction', bin: 'opened and closed; no storage or trade', errors };
});

test('portrait touch can approach and use the prompt without sending a ground click', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  const target = await worldPoint(page, 1.2, 1.2);
  await page.touchscreen.tap(target.x, target.y);
  const chicken = page.locator('.interaction-prompt[data-interactable="qa-chicken"]');
  await chicken.waitFor({ state: 'visible', timeout: 10000 });
  const box = await chicken.boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844);
  await capture(page, '09-touch-prompt.png');
  await chicken.tap();
  await waitForMessage(page, 'Fed chicken');
  const stopped = await position(page);
  await page.waitForTimeout(400);
  const later = await position(page);
  assert.ok(Math.hypot(stopped[0] - later[0], stopped[2] - later[2]) < 0.03);
  await capture(page, '10-touch-fed.png');
  assert.deepEqual(errors, []);
  proof.touch = { viewport: '390x844', prompt: box, fedByTap: true, stopped, later, errors };
});
