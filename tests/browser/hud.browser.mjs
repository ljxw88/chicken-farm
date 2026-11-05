import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer, preview } from 'vite';

const evidenceDir = process.env.EBR65_EVIDENCE_DIR;
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
  if (evidenceDir) await writeFile(join(evidenceDir, 'hud-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await devServer?.close();
  if (previewServer) await new Promise((resolve) => previewServer.httpServer.close(resolve));
});

async function openPage(context, url, inspectScene = false) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  if (inspectScene) {
    // Test-only scene access for hit projection and visibility; no game globals are added.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const body = `${await response.text()}\nwindow.__ebr65Test = { scene, camera, character };\n`;
      await route.fulfill({ response, body });
    });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('[data-collect]').waitFor({ state: 'visible' });
  if (inspectScene) await page.waitForFunction(() => Boolean(window.__ebr65Test));
  return { page, errors };
}

async function capture(page, name) {
  if (evidenceDir) await page.screenshot({ path: join(evidenceDir, name) });
}

async function waitForPrompt(page, id) {
  await page.waitForFunction((target) => {
    const prompt = document.querySelector(`.interaction-prompt[data-interactable="${target}"]`);
    return prompt && !prompt.hidden;
  }, id, { timeout: 15000 });
}

async function approachEgg(page) {
  const egg = page.locator('.interaction-prompt[data-interactable="qa-egg"]');
  await page.keyboard.down('s');
  try {
    await waitForPrompt(page, 'qa-chicken');
  } finally {
    await page.keyboard.up('s');
  }
  await page.keyboard.down('s');
  await page.keyboard.down('d');
  try {
    await waitForPrompt(page, 'qa-egg');
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('d');
  }
  return egg;
}

async function assertCollected(page) {
  await page.waitForFunction(() => document.querySelector('[data-supplies-count]')?.textContent === '5');
  assert.equal(await page.locator('[data-ready-count]').textContent(), '0 ready');
  assert.equal(await page.locator('[data-egg-status]').textContent(), 'Collected');
  assert.equal(await page.locator('[data-producer]').getAttribute('data-state'), 'collected');
  assert.equal(await page.locator('[data-collect]').isDisabled(), true);
  assert.equal(await page.locator('[data-collected-note]').isVisible(), true);
}

test('production HTML HUD: list Collect, buff disclosures, Build stub and refresh reset', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, previewUrl);
  const layout = await page.evaluate(() => {
    const root = document.querySelector('#farm-hud');
    const canvas = document.querySelector('#scene');
    return {
      siblings: root.parentElement === canvas.parentElement && canvas.nextElementSibling === root,
      imageRendering: getComputedStyle(root).imageRendering,
      blur: getComputedStyle(document.querySelector('.farm-growing')).backdropFilter,
      canvasAtCenter: document.elementFromPoint(innerWidth / 2, innerHeight / 2) === canvas,
    };
  });
  assert.deepEqual(layout.siblings, true);
  assert.equal(layout.imageRendering, 'auto');
  assert.match(layout.blur, /blur\(16px\)/);
  assert.equal(layout.canvasAtCenter, true);
  assert.equal(await page.locator('[data-supplies-count]').textContent(), '0');
  assert.equal(await page.locator('[data-ready-count]').textContent(), '1 ready');
  await capture(page, '01-hud-ready.png');

  await page.locator('[aria-controls="farm-spring-tip"]').click();
  assert.match(await page.locator('#farm-spring-tip').innerText(), /placeholder.*no growth bonus/i);
  await page.locator('[aria-controls="farm-bee-tip"]').click();
  assert.equal(await page.locator('#farm-spring-tip').isVisible(), false);
  assert.match(await page.locator('#farm-bee-tip').innerText(), /placeholder.*no pollination bonus/i);
  await page.locator('[aria-controls="farm-bee-tip"]').click();

  await page.locator('[data-build-toggle]').click();
  assert.equal(await page.locator('#farm-build-sheet').isVisible(), true);
  assert.match(await page.locator('#farm-build-sheet').innerText(), /Building is not available/);
  await capture(page, '02-build-stub.png');
  await page.locator('[data-build-close]').click();
  assert.equal(await page.locator('#farm-build-sheet').isVisible(), false);

  await page.locator('[data-collect]').click();
  await assertCollected(page);
  assert.match(await page.locator('.interaction-feedback').textContent(), /Collected egg/);
  await capture(page, '03-list-collected.png');
  await page.keyboard.press('e');
  assert.equal(await page.locator('[data-supplies-count]').textContent(), '5');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('[data-supplies-count]').textContent(), '0');
  assert.equal(await page.locator('[data-ready-count]').textContent(), '1 ready');
  assert.deepEqual(errors, []);
  proof.list = { browser: `Chromium ${browser.version()}`, layout, supplies: '0 → 5', reset: '0', errors };
});

test('production on-screen path: walk to egg and collect by prompt and by E', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, previewUrl);
  let egg = await approachEgg(page);
  assert.equal(await page.locator('[data-supplies-count]').textContent(), '0');
  await capture(page, '04-world-prompt.png');
  await egg.click();
  await assertCollected(page);
  assert.equal(await egg.isVisible(), false);
  await capture(page, '05-world-prompt-collected.png');
  await page.keyboard.press('e');
  assert.equal(await page.locator('[data-supplies-count]').textContent(), '5');

  await page.reload({ waitUntil: 'networkidle' });
  egg = await approachEgg(page);
  await page.keyboard.press('e');
  await assertCollected(page);
  assert.equal(await egg.isVisible(), false);
  await capture(page, '06-world-e-collected.png');

  await page.reload({ waitUntil: 'networkidle' });
  egg = await approachEgg(page);
  await page.locator('[data-collect]').click();
  await assertCollected(page);
  assert.equal(await egg.isVisible(), false); // A visible prompt must not remain usable after list Collect.
  await page.keyboard.press('e');
  assert.equal(await page.locator('[data-supplies-count]').textContent(), '5');
  assert.deepEqual(errors, []);
  proof.world = { walked: 'S, then S+D', collectedBy: ['prompt click', 'E', 'list with prompt open'], suppliesEach: '0 → 5', errors };
});

test('an in-range egg click and the remote list use the same one-shot world object', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, devUrl, true);
  await approachEgg(page);
  const point = await page.evaluate(() => {
    const { scene, camera, character } = window.__ebr65Test;
    const egg = scene.getObjectByName('qa-egg');
    const point = egg.getWorldPosition(character.position.clone());
    camera.updateMatrixWorld();
    point.project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  await page.mouse.click(point.x, point.y);
  await assertCollected(page);
  assert.equal(await page.evaluate(() => window.__ebr65Test.scene.getObjectByName('qa-egg-stub').visible), false);
  assert.equal(await page.locator('[data-collect]').isDisabled(), true);

  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.evaluate(() => window.__ebr65Test.scene.getObjectByName('qa-egg-stub').visible), true);
  await page.locator('[data-collect]').click();
  await assertCollected(page);
  assert.equal(await page.evaluate(() => window.__ebr65Test.scene.getObjectByName('qa-egg-stub').visible), false);

  // Walk to the former egg position: the list action must not leave a usable world egg behind.
  await page.keyboard.down('s');
  try {
    await waitForPrompt(page, 'qa-chicken');
  } finally {
    await page.keyboard.up('s');
  }
  await page.keyboard.down('s');
  await page.keyboard.down('d');
  try {
    await page.waitForFunction(() => {
      const { scene, character } = window.__ebr65Test;
      const position = scene.getObjectByName('qa-egg-stub').getWorldPosition(character.position.clone());
      return Math.hypot(character.position.x - position.x, character.position.z - position.z) <= 1.1;
    }, null, { timeout: 15000 });
  } finally {
    await page.keyboard.up('s');
    await page.keyboard.up('d');
  }
  assert.equal(await page.locator('.interaction-prompt[data-interactable="qa-egg"]').isVisible(), false);
  await page.keyboard.press('e');
  assert.equal(await page.locator('[data-supplies-count]').textContent(), '5');
  assert.deepEqual(errors, []);
  proof.oneShot = { worldObjectClick: point, remoteListAlsoHidesEgg: true, walkedToFormerEgg: true, suppliesEach: '0 → 5', errors };
});

test('small portrait and landscape keep chrome separated, accessible and on screen', { timeout: 60000 }, async () => {
  const sizes = [];
  for (const [width, height, mobile] of [[320, 568, true], [390, 844, true], [844, 390, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    try {
      const { page, errors } = await openPage(context, previewUrl);
      const biome = await page.locator('.farm-biome').boundingBox();
      const supplies = await page.locator('.farm-supplies').boundingBox();
      const growing = await page.locator('.farm-growing').boundingBox();
      const build = await page.locator('[data-build-toggle]').boundingBox();
      assert.ok(biome.x + biome.width < supplies.x, `${width}x${height}: top chrome overlaps`);
      assert.ok(growing.x >= 0 && growing.x + growing.width <= width);
      assert.ok(growing.y + growing.height < build.y, `${width}x${height}: panel overlaps Build`);
      assert.ok(build.y + build.height <= height);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      if (width === 320) await capture(page, '07-small-portrait.png');
      if (height === 390) await capture(page, '08-short-landscape.png');

      const activate = (selector) => mobile ? page.locator(selector).tap() : page.locator(selector).click();
      await activate('[data-growing-toggle]');
      assert.equal(await page.locator('#farm-growing-content').isVisible(), false);
      await activate('[data-build-toggle]');
      assert.equal(await page.locator('#farm-build-sheet').isVisible(), true);
      await activate('[data-build-close]');
      await activate('[data-growing-toggle]');
      await activate('[data-collect]');
      await assertCollected(page);
      assert.deepEqual(errors, []);
      sizes.push({ width, height, topGap: supplies.x - (biome.x + biome.width), errors });
    } finally {
      await context.close();
    }
  }
  proof.responsive = sizes;
});

test('the HUD phase follows the existing lighting cycle', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context, previewUrl);
  await page.evaluate(() => window.setDayNightPhase('sunset'));
  await page.waitForFunction(() => document.querySelector('[data-phase]')?.textContent === 'Sunset');
  await page.evaluate(() => window.setDayNightPhase('night'));
  await page.waitForFunction(() => document.querySelector('[data-phase]')?.textContent === 'Night');
  assert.deepEqual(errors, []);
});
