import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const evidenceDir = process.env.EBR47_EVIDENCE_DIR;
const names = ['cottage', 'ramp-coop-1', 'ramp-coop-2'];
const proof = { screenshots: [] };
let server;
let browser;
let url;

before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  proof.browser = `Chromium ${browser.version()} (headless, SwiftShader)`;
  proof.viewport = '1280x720';
});

after(async () => {
  if (evidenceDir) await writeFile(join(evidenceDir, 'browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await server?.close();
});

async function openPage(context, phase = 'daytime') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  // Expose live scene state for measurement and projection only; inputs below
  // still use the actual canvas, mouse and keyboard.
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr47Test = { scene, camera, character, obstacles };\n` });
  });
  await page.goto(`${url}/?phase=${phase}&weather=clear`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__ebr47Test && window.getPixelRendering?.().canvasWidth));
  return { page, errors };
}

async function capture(page, name) {
  if (!evidenceDir) return;
  await page.screenshot({ path: join(evidenceDir, name) });
  proof.screenshots.push(name);
}

async function worldPoint(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__ebr47Test;
    camera.updateMatrixWorld();
    const point = character.position.clone().set(x, 2.4, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, { x, z });
}

async function moveWorld(page, x, z) {
  const point = await worldPoint(page, x, z);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  await page.mouse.move(point.x, point.y);
  return point;
}

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

test('day and night show three placeholders with matching footprints and working practical lights', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const daytime = await page.evaluate((names) => {
    const { scene, obstacles, character } = window.__ebr47Test;
    scene.updateMatrixWorld(true);
    return {
      oldBarn: Boolean(scene.getObjectByName('farm-barn')),
      buildings: names.map((name) => {
        const mesh = scene.getObjectByName(`${name}-placeholder`);
        const position = mesh.getWorldPosition(character.position.clone());
        return { name, position: position.toArray(), size: mesh.geometry.parameters, obstacle: obstacles.find((entry) => entry.name === name) };
      }),
      pixel: window.getPixelRendering(),
    };
  }, names);
  assert.equal(daytime.oldBarn, false);
  assert.equal(daytime.pixel.enabled, true);
  assert.deepEqual([daytime.pixel.canvasWidth, daytime.pixel.canvasHeight], [320, 180]);
  for (const { position, size, obstacle } of daytime.buildings) {
    assert.ok(obstacle && obstacle.kind === 'box');
    near(obstacle.minX, position[0] - size.width / 2);
    near(obstacle.maxX, position[0] + size.width / 2);
    near(obstacle.minZ, position[2] - size.depth / 2);
    near(obstacle.maxZ, position[2] + size.depth / 2);
  }
  await capture(page, '01-day-placeholder.png');

  // A URL phase is held; calling the public phase setter would resume the
  // cycle and make the exact night-light assertion depend on frame timing.
  await page.close();
  const { page: nightPage, errors: nightErrors } = await openPage(context, 'night');
  const night = await nightPage.evaluate(() => {
    const { scene, character } = window.__ebr47Test;
    scene.updateMatrixWorld(true);
    return {
      windows: [1, 2].map((i) => {
        const pane = scene.getObjectByName(`cottage-window-${i}`);
        const light = scene.getObjectByName(`window-light-${i}`);
        return { parent: pane.parent.name, emissive: pane.material.emissiveIntensity,
          intensity: light.intensity, offsetZ: light.getWorldPosition(character.position.clone()).z - pane.getWorldPosition(character.position.clone()).z };
      }),
      lantern: character.getObjectByName('lantern-light').intensity,
      lanternParent: character.getObjectByName('lantern').parent.name,
      characterName: character.name,
    };
  });
  for (const window of night.windows) {
    assert.equal(window.parent, 'farm-cottage');
    near(window.emissive, 0.85);
    near(window.intensity, 0.85);
    near(window.offsetZ, 0.7);
  }
  near(night.lantern, 0.55);
  assert.equal(night.lanternParent, night.characterName);
  await capture(nightPage, '02-night-placeholder.png');
  assert.deepEqual(errors, []);
  assert.deepEqual(nightErrors, []);
  proof.appearanceAndLights = { daytime, night, errors: [...errors, ...nightErrors] };
});

test('real fence and plot previews reject all three buildings, including rotated ghosts', { timeout: 60000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const buildings = await page.evaluate((names) => names.map((name) => {
    const obstacle = window.__ebr47Test.obstacles.find((entry) => entry.name === name);
    return { name, x: (obstacle.minX + obstacle.maxX) / 2, z: (obstacle.minZ + obstacle.maxZ) / 2 };
  }), names);
  const rejected = [];
  for (const kind of ['fence', 'plot']) {
    for (const rotation of [0, 1]) {
      for (const building of buildings) {
        await page.keyboard.press(kind === 'fence' ? 'f' : 'p');
        if (rotation) await page.keyboard.press('r');
        const point = await moveWorld(page, building.x, building.z);
        assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/, `${kind} on ${building.name}`);
        assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
        assert.equal(await page.evaluate(() => window.__ebr47Test.scene.getObjectByName('placement-wash').material.color.getHex()), 0xc45a3a);
        await page.mouse.click(point.x, point.y);
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate((name) => window.__ebr47Test.scene.getObjectsByProperty('name', `placed-${name}`).length, kind), 0);
        rejected.push(`${kind}/${rotation}/${building.name}`);
      }
    }
  }
  await capture(page, '03-coop-plot-rejected.png');
  await page.keyboard.press('f');
  const open = await moveWorld(page, -6.75, -6.75);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await page.mouse.click(open.x, open.y);
  assert.equal(await page.evaluate(() => window.__ebr47Test.scene.getObjectsByProperty('name', 'placed-fence').length), 1);
  await page.keyboard.press('z');
  assert.equal(await page.evaluate(() => window.__ebr47Test.obstacles.length), 8);
  assert.deepEqual(errors, []);
  proof.placement = { rejected, adjacentFreeSpace: true, errors };
});

test('actual clicks and WASD stop at the front of every visible building', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const buildings = await page.evaluate((names) => names.map((name) => {
    const obstacle = window.__ebr47Test.obstacles.find((entry) => entry.name === name);
    return { name, x: (obstacle.minX + obstacle.maxX) / 2, front: obstacle.maxZ };
  }), names);
  const stopped = [];
  for (const building of buildings) {
    const approach = { x: building.x, z: building.front + 1.1 };
    const point = await worldPoint(page, approach.x, approach.z);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(({ x, z }) => {
      const p = window.__ebr47Test.character.position;
      return Math.hypot(p.x - x, p.z - z) < 0.05;
    }, approach, { timeout: 15000 });
    // W+D is world -Z: keep pushing after reaching the visible front face.
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    try {
      await page.waitForFunction((front) => window.__ebr47Test.character.position.z < front + 0.43, building.front, { timeout: 10000 });
      await page.waitForTimeout(250);
    } finally {
      await page.keyboard.up('w');
      await page.keyboard.up('d');
    }
    const position = await page.evaluate(() => window.__ebr47Test.character.position.toArray());
    assert.ok(position[2] >= building.front + 0.4 - 1e-5 && position[2] < building.front + 0.43, `${building.name}: ${position}`);
    stopped.push({ name: building.name, front: building.front, position });
  }
  await capture(page, '04-coop-walk-blocked.png');
  assert.deepEqual(errors, []);
  proof.walking = { stopped, errors };
});
