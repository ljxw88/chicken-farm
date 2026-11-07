import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import * as THREE from 'three';
import { createServer } from 'vite';

const evidenceDir = process.env.EBR47_EVIDENCE_DIR;
const componentNames = ['cottage', 'ramp-coop-1-body', 'ramp-coop-1-ramp', 'ramp-coop-2-body', 'ramp-coop-2-ramp'];
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

async function openPage(context, phase = 'daytime', weather = 'clear') {
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failedRequests.push(`${response.status()}: ${response.url()}`);
  });
  // Expose scene state for measurement and projection only; interaction tests
  // still use the real canvas, mouse and keyboard.
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr47Test = typeof context !== 'undefined' ? context : { scene, camera, character, obstacles };\n` });
  });
  await page.goto(`${url}/?phase=${phase}&weather=${weather}`, { waitUntil: 'networkidle' });
  try {
    await page.waitForFunction(() => Boolean(window.__ebr47Test && window.getPixelRendering?.().canvasWidth));
  } catch (cause) {
    const state = await page.evaluate(() => ({ readyState: document.readyState, sceneExposed: Boolean(window.__ebr47Test),
      pixelApi: typeof window.getPixelRendering, canvas: Boolean(document.querySelector('#scene')) })).catch(() => null);
    throw new Error(`Building scene did not initialize: ${JSON.stringify({ phase, weather, errors, failedRequests, state })}`, { cause });
  }
  if (weather === 'rain') await page.waitForFunction(() => window.getWeather().rainAmount > 0.99, null, { timeout: 15000 });
  return { page, errors };
}

async function capture(page, name, clip) {
  if (!evidenceDir) return;
  await page.screenshot({ path: join(evidenceDir, name), ...(clip ? { clip } : {}) });
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

async function probeTreeRoofOverlap() {
  // Measure the actual 3D meshes in a separate scene, not just overlapping
  // projected silhouettes or their bounding boxes. Never move the live tree.
  const { createFarmLayout } = await server.ssrLoadModule('/src/scene/createFarmLayout.ts');
  const scene = new THREE.Scene();
  createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const roof = scene.getObjectByName('ramp-coop-2-roof');
  const crowns = scene.getObjectByName('farm-tree-4').children
    .filter((child) => child.isMesh && child.geometry.type === 'IcosahedronGeometry');
  roof.children.forEach((child) => { child.material.side = THREE.DoubleSide; });
  crowns.forEach((crown) => { crown.material.side = THREE.DoubleSide; });
  const roofBox = new THREE.Box3().setFromObject(roof);
  const canopyBox = crowns.reduce((box, crown) => box.union(new THREE.Box3().setFromObject(crown)), new THREE.Box3());
  const ray = new THREE.Raycaster();
  const step = 0.02;
  let overlappingSamples = 0;
  let example;
  for (let x = Math.max(roofBox.min.x, canopyBox.min.x); x <= Math.min(roofBox.max.x, canopyBox.max.x); x += step) {
    for (let z = Math.max(roofBox.min.z, canopyBox.min.z); z <= Math.min(roofBox.max.z, canopyBox.max.z); z += step) {
      ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
      const roofHits = ray.intersectObject(roof, true);
      if (roofHits.length < 2) continue;
      const roofTop = roofHits[0].point.y;
      const roofBottom = roofHits.at(-1).point.y;
      const overlap = crowns.some((crown) => {
        const hits = ray.intersectObject(crown);
        return hits.length >= 2 && Math.min(roofTop, hits[0].point.y) > Math.max(roofBottom, hits.at(-1).point.y) + 1e-6;
      });
      if (overlap) {
        overlappingSamples++;
        example ??= { x, z, roofBottom, roofTop };
      }
    }
  }
  return { step, overlappingSamples, example };
}

test('locked buildings render at day, sunset, night and rain with the practical lights', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const daytime = await page.evaluate((names) => {
    const { scene, obstacles } = window.__ebr47Test;
    scene.updateMatrixWorld(true);
    return {
      oldBarn: Boolean(scene.getObjectByName('farm-barn')),
      components: names.map((name) => obstacles.find((entry) => entry.name === name)),
      names: ['farm-cottage', 'farm-ramp-coop-1', 'farm-ramp-coop-2', 'cottage-chimney-top']
        .map((name) => Boolean(scene.getObjectByName(name))),
      pixel: window.getPixelRendering(),
    };
  }, componentNames);
  assert.equal(daytime.oldBarn, false);
  assert.ok(daytime.names.every(Boolean));
  assert.equal(daytime.components.length, 5);
  assert.ok(daytime.components.every((obstacle) => obstacle?.kind === 'box'));
  assert.equal(daytime.pixel.enabled, true);
  assert.deepEqual([daytime.pixel.canvasWidth, daytime.pixel.canvasHeight], [320, 180]);
  await capture(page, '01-daytime-front.png');

  // Crop the same unaltered 1280x720 view; do not move tree 4 or the camera.
  await capture(page, '05-tree4-coopB-crop.png', { x: 720, y: 185, width: 160, height: 180 });
  const tree4 = await page.evaluate(() => {
    const { scene } = window.__ebr47Test;
    const tree = scene.getObjectByName('farm-tree-4');
    const roof = scene.getObjectByName('ramp-coop-2-roof');
    scene.updateMatrixWorld(true);
    const worldBox = (mesh) => {
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    };
    const roofParts = roof.children.filter((child) => child.isMesh).map(worldBox);
    const roofBox = roofParts.slice(1).reduce((box, part) => box.union(part), roofParts[0].clone());
    const crowns = tree.children.filter((child) => child.isMesh && child.geometry.type === 'IcosahedronGeometry');
    return { position: tree.position.toArray(), crownBoxesOverlappingRoof: crowns.map((crown) => worldBox(crown).intersectsBox(roofBox)) };
  });
  near(tree4.position[0], -0.35);
  near(tree4.position[2], -5.8);
  proof.tree4 = { ...tree4, meshProbe: await probeTreeRoofOverlap() }; // Report, do not assert this as a desired layout.
  assert.deepEqual(errors, []);
  await page.close();

  const sunset = await openPage(context, 'sunset');
  await capture(sunset.page, '02-sunset.png');
  assert.deepEqual(sunset.errors, []);
  await sunset.page.close();

  // URL phases are held, avoiding a frame-timing race in the intensity checks.
  const night = await openPage(context, 'night');
  const lights = await night.page.evaluate(() => {
    const { scene, character } = window.__ebr47Test;
    scene.updateMatrixWorld(true);
    const points = [];
    scene.traverse((object) => { if (object.isPointLight) points.push(object.name); });
    return {
      windows: [1, 2].map((i) => {
        const pane = scene.getObjectByName(`cottage-window-${i}`);
        const light = scene.getObjectByName(`window-light-${i}`);
        return { parent: pane.parent.name, emissive: pane.material.emissiveIntensity,
          intensity: light.intensity, offsetZ: light.getWorldPosition(character.position.clone()).z - pane.getWorldPosition(character.position.clone()).z };
      }),
      accents: ['cottage-east-window', 'ramp-coop-1-pop-hole-glow', 'ramp-coop-2-pop-hole-glow']
        .map((name) => scene.getObjectByName(name).material.emissiveIntensity),
      points: points.sort(),
      lantern: character.getObjectByName('lantern-light').intensity,
      lanternParent: character.getObjectByName('lantern').parent.name,
      characterName: character.name,
    };
  });
  for (const window of lights.windows) {
    assert.equal(window.parent, 'farm-cottage');
    near(window.emissive, 0.85);
    near(window.intensity, 0.85);
    near(window.offsetZ, 0.7);
  }
  near(lights.accents[0], 0.85);
  near(lights.accents[1], 0.85 * 0.7);
  near(lights.accents[2], 0.85 * 0.7);
  assert.deepEqual(lights.points, ['lantern-light', 'window-light-1', 'window-light-2']);
  near(lights.lantern, 0.12);
  assert.equal(lights.lanternParent, lights.characterName);
  await capture(night.page, '03-night-glow.png');
  assert.deepEqual(night.errors, []);
  await night.page.close();

  const rain = await openPage(context, 'daytime', 'rain');
  await capture(rain.page, '04-rain.png');
  assert.deepEqual(rain.errors, []);
  proof.appearanceAndLights = { daytime, lights, weather: await rain.page.evaluate(() => window.getWeather()), errors: [] };
});

test('real fence and plot previews reject the cottage, both bodies and both ramps', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const initialObstacles = await page.evaluate(() => window.__ebr47Test.obstacles.length);
  const components = await page.evaluate((names) => names.map((name) => {
    const obstacle = window.__ebr47Test.obstacles.find((entry) => entry.name === name);
    return { name, x: (obstacle.minX + obstacle.maxX) / 2, z: (obstacle.minZ + obstacle.maxZ) / 2 };
  }), componentNames);
  const rejected = [];
  for (const kind of ['fence', 'plot']) {
    for (const rotation of [0, 1]) {
      for (const component of components) {
        await page.keyboard.press(kind === 'fence' ? 'f' : 'p');
        if (rotation) await page.keyboard.press('r');
        const point = await moveWorld(page, component.x, component.z);
        assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/, `${kind} on ${component.name}`);
        assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
        assert.equal(await page.evaluate(() => window.__ebr47Test.scene.getObjectByName('placement-wash').material.color.getHex()), 0xc45a3a);
        await page.mouse.click(point.x, point.y);
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate((name) => window.__ebr47Test.scene.getObjectsByProperty('name', `placed-${name}`).length, kind), 0);
        rejected.push(`${kind}/${rotation}/${component.name}`);
      }
    }
  }
  await capture(page, '06-ramp-plot-rejected.png');
  await page.keyboard.press('f');
  const open = await moveWorld(page, -6.75, -6.75);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  await page.mouse.click(open.x, open.y);
  assert.equal(await page.evaluate(() => window.__ebr47Test.scene.getObjectsByProperty('name', 'placed-fence').length), 1);
  await page.keyboard.press('z');
  assert.equal(await page.evaluate(() => window.__ebr47Test.obstacles.length), initialObstacles);
  assert.deepEqual(errors, []);
  proof.placement = { rejected, openTile: true, errors };
});

test('actual clicks and WASD stop at the cottage wall and both ramp fronts', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const { page, errors } = await openPage(context);
  const components = await page.evaluate((names) => names.map((name) => {
    const obstacle = window.__ebr47Test.obstacles.find((entry) => entry.name === name);
    return { name, x: (obstacle.minX + obstacle.maxX) / 2, front: obstacle.maxZ };
  }), ['cottage', 'ramp-coop-1-ramp', 'ramp-coop-2-ramp']);

  async function walkTo(x, z) {
    const point = await worldPoint(page, x, z);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(({ x, z }) => {
      const p = window.__ebr47Test.character.position;
      return Math.hypot(p.x - x, p.z - z) < 0.05;
    }, { x, z }, { timeout: 15000 });
  }

  const stopped = [];
  for (const component of components) {
    await walkTo(0, 0);
    if (component.name === 'ramp-coop-2-ramp') await walkTo(1.8, 0.2);
    await walkTo(component.x, component.front + 1.1);
    // W+D is world -Z: keep pushing after reaching the visible front face.
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    try {
      await page.waitForFunction((front) => window.__ebr47Test.character.position.z < front + 0.43, component.front, { timeout: 10000 });
      await page.waitForTimeout(250);
    } finally {
      await page.keyboard.up('w');
      await page.keyboard.up('d');
    }
    const position = await page.evaluate(() => window.__ebr47Test.character.position.toArray());
    assert.ok(position[2] >= component.front + 0.4 - 1e-5 && position[2] < component.front + 0.43, `${component.name}: ${position}`);
    stopped.push({ name: component.name, front: component.front, position });
  }
  await capture(page, '07-ramp-walk-blocked.png');
  assert.deepEqual(errors, []);
  proof.walking = { stopped, errors };
});
