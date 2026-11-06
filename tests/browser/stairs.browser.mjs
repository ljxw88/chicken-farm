import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const evidenceDir = process.env.EBR46_EVIDENCE_DIR;
const slideProofPath = process.env.EBR46_SLIDE_PROOF;
const slideResults = [];
let devServer;
let browser;
let url = process.env.EBR46_URL;
let proof;

before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  if (!url) {
    devServer = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
    await devServer.listen();
    const address = devServer.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    url = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});

after(async () => {
  if (evidenceDir && proof) await writeFile(join(evidenceDir, 'browser-proof.json'), `${JSON.stringify(proof, null, 2)}\n`);
  if (slideProofPath && slideResults.length === 3) {
    await mkdir(dirname(slideProofPath), { recursive: true });
    await writeFile(slideProofPath, `${JSON.stringify({ browser: `Chromium ${browser.version()}`, url,
      viewport: '1280x720', scenarios: slideResults }, null, 2)}\n`);
  }
  await browser?.close();
  await devServer?.close();
});

async function capture(page, name) {
  return page.screenshot(evidenceDir ? { path: join(evidenceDir, name) } : {});
}

async function samplePixels(page, screenshot, points) {
  return page.evaluate(async ({ data, points }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]);
  }, { data: screenshot.toString('base64'), points });
}

function collectErrors(page, errors) {
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
}

async function assertNoSimUi(page) {
  const forbidden = [
    '.farm-supplies', '.farm-growing', '.farm-inventory', '.farm-market', '.farm-build',
    '.interaction-prompt', '.interaction-feedback', '[data-collect]', '[data-sell-egg]',
    '[data-buy-feed]', '[data-place-fence]', '[data-build-toggle]',
  ];
  assert.equal(await page.locator(forbidden.join(',')).count(), 0);
  // Free fence placement is present, but the stripped simulation UI stays absent.
  assert.doesNotMatch(await page.locator('body').innerText(), /\b(inventory|collect|egg|feed|supplies|buy|sell|market|build)\b/i);
}

async function holdUntil(page, keys, predicate, argument, dwell = 0) {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await page.waitForFunction(predicate, argument, { timeout: 20000 });
    if (dwell) await page.waitForTimeout(dwell);
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}

async function holdFor(page, keys, milliseconds) {
  for (const key of keys) await page.keyboard.down(key);
  try {
    await page.waitForTimeout(milliseconds);
  } finally {
    for (const key of keys) await page.keyboard.up(key);
  }
}

function assertNoClipping(frame, boxes) {
  const radius = 0.4;
  const center = [frame.x, frame.y + radius, frame.z];
  for (const box of boxes) {
    const mins = [box.minX, box.minY, box.minZ];
    const maxs = [box.maxX, box.maxY, box.maxZ];
    const distanceSquared = center.reduce((sum, value, axis) => {
      const nearest = Math.max(mins[axis], Math.min(maxs[axis], value));
      return sum + (value - nearest) ** 2;
    }, 0);
    assert.ok(distanceSquared >= radius ** 2 - 1e-6, `capsule clipped a riser: ${JSON.stringify(frame)}`);
  }

  for (let i = 0; i < 64; i++) {
    const x = frame.x + radius * Math.cos(i * Math.PI / 32);
    const z = frame.z + radius * Math.sin(i * Math.PI / 32);
    const onIsland = Math.abs(x) <= 8 + 1e-6 && Math.abs(z) <= 8 + 1e-6;
    const onStone = boxes.some((box) => x >= box.minX - 1e-6 && x <= box.maxX + 1e-6 &&
      z >= box.minZ - 1e-6 && z <= box.maxZ + 1e-6);
    assert.ok(onIsland || onStone, `footprint over void: ${JSON.stringify(frame)}`);
  }
}

test('real clicks and WASD traverse the visible stairs and foot pad without clipping', { timeout: 120000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  t.after(() => context.close());
  const errors = [];

  // The overview is the unmodified dev app; the second page exposes only
  // scene state for measurement, following the existing browser-test pattern.
  const overview = await context.newPage();
  collectErrors(overview, errors);
  await overview.goto(`${url}/?phase=daytime`, { waitUntil: 'networkidle' });
  const rendering = await overview.evaluate(() => ({
    pixel: window.getPixelRendering(),
    webgl: document.querySelector('#scene').getContext('webgl2')?.getParameter(7938),
  }));
  assert.equal(rendering.pixel.enabled, true);
  assert.equal(rendering.pixel.cssPixelSize, 4);
  assert.deepEqual([rendering.pixel.canvasWidth, rendering.pixel.canvasHeight], [320, 180]);
  assert.match(rendering.webgl, /WebGL 2\.0/);
  await assertNoSimUi(overview);
  const overviewScreenshot = await capture(overview, '01-daytime-overview.png');
  await overview.close();

  const page = await context.newPage();
  collectErrors(page, errors);
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr46Test = { scene, camera, character, stairs };\n` });
  });
  await page.goto(`${url}/?phase=daytime`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__ebr46Test));
  await assertNoSimUi(page);

  const geometry = await page.evaluate(async () => {
    const { scene, camera, stairs } = window.__ebr46Test;
    const { FARM_PALETTE } = await import('/src/scene/farmPalette.ts');
    const rgb = (hex) => [hex >> 16 & 255, hex >> 8 & 255, hex & 255];
    const describe = (mesh) => {
      const p = mesh.getWorldPosition(mesh.position.clone());
      const { width, height, depth } = mesh.geometry.parameters;
      return {
        minX: p.x - width / 2, maxX: p.x + width / 2,
        minY: p.y - height / 2, maxY: p.y + height / 2,
        minZ: p.z - depth / 2, maxZ: p.z + depth / 2,
      };
    };
    camera.updateMatrixWorld();
    const project = (point) => {
      point.project(camera);
      return [Math.round((point.x + 1) * 640), Math.round((1 - point.y) * 360)];
    };
    return {
      background: scene.background.getHex(),
      ground: scene.getObjectByName('island-top').geometry.parameters,
      boxes: stairs.treads.map(describe),
      pad: describe(stairs.footPad),
      colors: {
        stairSourceWood: rgb(FARM_PALETTE.barnWood),
        dirtPath: rgb(scene.getObjectByName('farm-path-surface').material.color.getHex()),
        riser: rgb(stairs.treads[0].material[0].color.getHex()),
        treads: stairs.treads.map((mesh) => rgb(mesh.material[2].color.getHex())),
        edges: stairs.treads.map((mesh) => rgb(mesh.material[6].color.getHex())),
        emissive: [...stairs.treads, stairs.footPad].flatMap((mesh) => mesh.material.map((material) => material.emissive.getHex())),
      },
      topPoints: stairs.treads.map((mesh) => {
        const p = mesh.getWorldPosition(mesh.position.clone());
        p.y += mesh.geometry.parameters.height / 2;
        return project(p);
      }),
      riserPoints: stairs.treads.map((mesh) => {
        const p = mesh.getWorldPosition(mesh.position.clone());
        p.x += mesh.geometry.parameters.width / 2;
        p.y += mesh.geometry.parameters.height / 2 - 0.24;
        return project(p);
      }),
      edgePoints: stairs.treads.map((mesh) => {
        const p = mesh.getWorldPosition(mesh.position.clone());
        p.x += mesh.geometry.parameters.width / 2 - 0.09;
        p.y += mesh.geometry.parameters.height / 2;
        return project(p);
      }),
    };
  });
  assert.equal(geometry.background, 0x101416);
  assert.deepEqual([geometry.ground.width, geometry.ground.height], [16, 16]);
  assert.equal(geometry.boxes.length, 5);
  assert.deepEqual(geometry.colors.stairSourceWood, [212, 165, 116]);
  assert.deepEqual(geometry.colors.dirtPath, [166, 124, 82]);
  assert.ok(geometry.colors.emissive.every((value) => value === 0));
  assert.ok(Math.abs(geometry.pad.maxX - geometry.pad.minX - 1.5) < 1e-6);
  assert.ok(Math.abs(geometry.pad.maxZ - geometry.pad.minZ - 1.6) < 1e-6);
  assert.ok(Math.abs(geometry.pad.maxY - geometry.pad.minY - 0.16) < 1e-6);
  const dayPixels = await samplePixels(page, overviewScreenshot,
    [geometry.topPoints[3], geometry.riserPoints[3], geometry.edgePoints[3], [1200, 300]]);
  await page.evaluate(() => {
    window.__ebr46Stage = 'approach';
    window.__ebr46Frames = [];
    function record() {
      const { character } = window.__ebr46Test;
      window.__ebr46Frames.push({ stage: window.__ebr46Stage, x: character.position.x, y: character.position.y, z: character.position.z });
      requestAnimationFrame(record);
    }
    requestAnimationFrame(record);
  });

  const click = await page.evaluate(() => {
    const { camera, stairs } = window.__ebr46Test;
    const mesh = stairs.footPad;
    const point = mesh.getWorldPosition(mesh.position.clone());
    point.y += mesh.geometry.parameters.height / 2;
    camera.updateMatrixWorld();
    point.project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  });
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, click), 'scene');
  await page.evaluate(() => { window.__ebr46Stage = 'descent'; });
  await page.mouse.click(click.x, click.y);
  const padCenterX = (geometry.pad.minX + geometry.pad.maxX) / 2;
  await page.waitForFunction((x) => window.__ebr46Test.character.position.x > x - 0.01, padCenterX, { timeout: 20000 });
  await holdUntil(page, ['s', 'd'], (x) => window.__ebr46Test.character.position.x > x - 0.005,
    geometry.pad.maxX - 0.4, 300);
  await page.waitForTimeout(100);
  const bottom = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(Math.abs(bottom[0] - (geometry.pad.maxX - 0.4)) < 0.001);
  assert.ok(Math.abs(bottom[1] - geometry.pad.maxY) < 0.01);
  await capture(page, '02-bottom-tread.png');

  await page.evaluate(() => { window.__ebr46Stage = 'side-boundaries'; });
  await holdUntil(page, ['s', 'a'], (z) => window.__ebr46Test.character.position.z > z - 0.005,
    geometry.pad.maxZ - 0.4, 100);
  const sideA = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(Math.abs(sideA[2] - (geometry.pad.maxZ - 0.4)) < 0.001);
  await holdUntil(page, ['w', 'd'], (z) => window.__ebr46Test.character.position.z < z + 0.005,
    geometry.pad.minZ + 0.4, 100);
  const sideB = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(Math.abs(sideB[2] - (geometry.pad.minZ + 0.4)) < 0.001);

  const centerTarget = { x: geometry.pad.maxX - 0.55, y: geometry.pad.maxY, z: 0.75 };
  const centerPoint = await page.evaluate(({ x, y, z }) => {
    const { camera, character } = window.__ebr46Test;
    camera.updateMatrixWorld();
    const point = character.position.clone().set(x, y, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
  }, centerTarget);
  await page.mouse.click(centerPoint.x, centerPoint.y);
  await page.waitForFunction(({ x, z }) => Math.hypot(window.__ebr46Test.character.position.x - x,
    window.__ebr46Test.character.position.z - z) < 0.03, centerTarget, { timeout: 20000 });

  await page.evaluate(() => { window.__ebr46Stage = 'ascent'; });
  await holdUntil(page, ['w', 'a'], () => window.__ebr46Test.character.position.x < 10.5);
  const middle = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(middle[1] > bottom[1] && middle[1] < 2.4);
  await capture(page, '03-mid-climb.png');
  await holdUntil(page, ['w', 'a'], () => window.__ebr46Test.character.position.x < 7.4);
  const top = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
  assert.ok(Math.abs(top[1] - 2.4) < 1e-6);
  await capture(page, '04-returned-to-path.png');
  await assertNoSimUi(page);

  const frames = await page.evaluate(() => window.__ebr46Frames);
  const descent = frames.filter((frame) => frame.stage === 'descent');
  const ascent = frames.filter((frame) => frame.stage === 'ascent');
  assert.ok(descent.length >= 20 && ascent.length >= 20);
  assert.ok(Math.min(...descent.map((frame) => frame.y)) < 0.2);
  assert.ok(Math.max(...ascent.map((frame) => frame.y)) >= 2.39);
  for (const frame of frames) assertNoClipping(frame, [...geometry.boxes, geometry.pad]);

  const night = await context.newPage();
  collectErrors(night, errors);
  await night.goto(`${url}/?phase=night`, { waitUntil: 'networkidle' });
  assert.equal(await night.locator('[data-phase]').textContent(), 'Night');
  await assertNoSimUi(night);
  const nightScreenshot = await capture(night, '05-night-overview.png');
  const nightPixels = await samplePixels(night, nightScreenshot, [geometry.topPoints[3], geometry.edgePoints[3], [1200, 300]]);
  assert.ok(nightPixels[1][0] > nightPixels[2][0] + 8, 'night tread edge should remain distinguishable from the void');
  assert.deepEqual(errors, []);
  proof = {
    browser: `Chromium ${browser.version()}`, url, viewport: '1280x720', rendering,
    geometry, pixels: { day: dayPixels, night: nightPixels },
    input: { footPadClick: click, bottom, sideA, sideB, middle, top },
    frames: { total: frames.length, descent: descent.length, ascent: ascent.length, clippedOrUnsupported: 0 },
    errors,
  };
});

const padSideScenarios = [
  { name: 'A: S+A then W+A', pushes: [['s', 'a']], climbMs: 4000, sideZ: 1.15 },
  { name: 'B: W+D then W+A', pushes: [['w', 'd']], climbMs: 6000, sideZ: 0.35 },
  { name: 'S+D, S+A, W+D, W+A', pushes: [['s', 'd'], ['s', 'a'], ['w', 'd']], climbMs: 6000, sideZ: 0.35 },
];

for (const scenario of padSideScenarios) {
  test(`pad-side QA ${scenario.name} reaches the path without leaving the visible ground`, { timeout: 60000 }, async (t) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    t.after(() => context.close());
    const page = await context.newPage();
    const errors = [];
    collectErrors(page, errors);
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr46Test = { scene, camera, character, stairs };\n` });
    });
    await page.goto(`${url}/?phase=daytime`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__ebr46Test));
    await assertNoSimUi(page);
    const boxes = await page.evaluate(() => {
      const { stairs } = window.__ebr46Test;
      return [...stairs.treads, stairs.footPad].map((mesh) => {
        const p = mesh.getWorldPosition(mesh.position.clone());
        const { width, height, depth } = mesh.geometry.parameters;
        return {
          minX: p.x - width / 2, maxX: p.x + width / 2,
          minY: p.y - height / 2, maxY: p.y + height / 2,
          minZ: p.z - depth / 2, maxZ: p.z + depth / 2,
        };
      });
    });
    await page.evaluate(() => {
      window.__ebr46Stage = 'approach';
      window.__ebr46Frames = [];
      function record() {
        const { character } = window.__ebr46Test;
        window.__ebr46Frames.push({ stage: window.__ebr46Stage, x: character.position.x, y: character.position.y, z: character.position.z });
        requestAnimationFrame(record);
      }
      requestAnimationFrame(record);
    });

    // Reproduce QA with real pointer and key input; do not recenter or teleport.
    assert.equal(await page.evaluate(() => document.elementFromPoint(947, 646)?.id), 'scene');
    await page.mouse.click(947, 646);
    await page.waitForFunction(() => {
      const { character, stairs } = window.__ebr46Test;
      return Math.hypot(character.position.x - stairs.footPad.position.x, character.position.z - 0.75) < 0.03;
    }, null, { timeout: 20000 });
    for (const keys of scenario.pushes) await holdFor(page, keys, 2200);
    const afterPush = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
    assert.ok(Math.abs(afterPush[2] - scenario.sideZ) < 0.02, `${scenario.name}: did not reach pad side`);
    await page.evaluate(() => { window.__ebr46Stage = 'climb'; });
    await holdFor(page, ['w', 'a'], scenario.climbMs);
    const afterClimb = await page.evaluate(() => window.__ebr46Test.character.position.toArray());
    const frames = await page.evaluate(() => window.__ebr46Frames);
    const pathCrossing = await page.evaluate(() => {
      const { scene, character } = window.__ebr46Test;
      const path = scene.getObjectByName('farm-path-surface');
      path.updateWorldMatrix(true, false);
      const positions = path.geometry.getAttribute('position');
      const indices = path.geometry.getIndex();
      const vertex = (index) => path.localToWorld(character.position.clone().fromBufferAttribute(positions, index));
      const triangles = [];
      for (let i = 0; i < indices.count; i += 3) {
        triangles.push([vertex(indices.getX(i)), vertex(indices.getX(i + 1)), vertex(indices.getX(i + 2))]);
      }
      const sign = (a, b, point) => (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
      return window.__ebr46Frames.find((point) => point.stage === 'climb' && Math.abs(point.y - 2.4) < 1e-6 &&
        triangles.some(([a, b, c]) => {
          if (Math.abs(sign(a, b, c)) < 1e-10) return false;
          const sides = [sign(a, b, point), sign(b, c, point), sign(c, a, point)];
          return !sides.some((side) => side < -1e-7) || !sides.some((side) => side > 1e-7);
        }));
    });
    for (const frame of frames) assertNoClipping(frame, boxes);
    assert.ok(afterClimb[0] < 7.6 && Math.abs(afterClimb[1] - 2.4) < 1e-6,
      `${scenario.name}: stuck at ${afterClimb}`);
    assert.ok(pathCrossing, `${scenario.name}: did not reach the dirt path`);
    await assertNoSimUi(page);
    assert.deepEqual(errors, []);
    slideResults.push({ scenario: scenario.name, pushesMs: 2200, climbMs: scenario.climbMs,
      afterPush, afterClimb, pathCrossing, frames: frames.length, clippedOrUnsupported: 0, errors });
  });
}
