import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const evidence = process.env.EBR70_EVIDENCE_DIR;
let server;
let browser;
let url = process.env.EBR70_URL;

before(async () => {
  if (evidence) await mkdir(evidence, { recursive: true });
  if (!url) {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    url = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'],
  });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function open(context, seed = 123) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Real keyboard input, with the app's animation loop stepped deterministically.
  await page.addInitScript(() => {
    let randomState = 0xeb730001;
    window.__ebr70RainRandom = () => {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr70Step = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame scheduled');
      for (const callback of current) callback(time);
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
    await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr70RainRandom,')}
window.__ebr70 = { scene, camera, character, obstacles, follow, composer, renderer, dayNight, weather };\n` });
  });
  await page.goto(`${url}/?phase=daytime&weather=clear&seed=${seed}`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => Boolean(window.__ebr70)));
  await page.evaluate(() => window.__ebr70Step(0));
  return { page, errors };
}

async function capture(page, name) {
  if (!evidence) return;
  const cdp = await page.context().newCDPSession(page);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(evidence, name), Buffer.from(shot.data, 'base64'));
  await cdp.detach();
}

test('real WASD walks around the fold, through the opening and back out; fence, sheep and shelter block', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const { page, errors } = await open(context);
  let time = 0;
  const path = [];
  async function move(keys, frames) {
    for (const key of keys) await page.keyboard.down(key);
    const positions = await page.evaluate(({ frames, start }) => {
      const result = [];
      for (let i = 1; i <= frames; i++) {
        window.__ebr70Step(start + i * 100);
        result.push(window.__ebr70.character.position.toArray());
      }
      return result;
    }, { frames, start: time });
    time += frames * 100;
    for (const key of keys) await page.keyboard.up(key);
    path.push(...positions);
    return positions.at(-1);
  }

  const frontApproach = await move(['s', 'a'], 20); // +Z, clear of tree 1.
  assert.ok(frontApproach[2] > 6.9 && Math.abs(frontApproach[0]) < 0.01);
  const westRim = await move(['w', 'a'], 22); // -X, around the front-west corner.
  assert.ok(westRim[0] < -7.55 && westRim[2] > 6.9);
  const behindWest = await move(['w', 'd'], 13); // -Z, between the west fence and rim.
  assert.ok(behindWest[0] < -7.5 && behindWest[2] < 2.5, `west rim corridor blocked: ${behindWest}`);
  const behindEast = await move(['s', 'd'], 17); // +X, between the back fence and tree 1.
  assert.ok(behindEast[0] > -1.7 && behindEast[2] < 2.5, `back corridor blocked: ${behindEast}`);
  const eastFront = await move(['s', 'a'], 13); // +Z, around the east side.
  assert.ok(eastFront[2] > 6.9, `east corridor blocked: ${eastFront}`);
  const openingApproach = await move(['w', 'a'], 9); // -X, along the front to the opening.
  assert.ok(openingApproach[0] < -4.7 && openingApproach[0] > -4.9 && openingApproach[2] > 6.9);
  await capture(page, '01-opening-approach.png');
  const entered = await move(['w', 'd'], 12); // -Z through the opening, up to the lean-to.
  assert.ok(entered[2] < 5.15 && entered[2] >= 4.94 - 1e-6, `shelter failed: ${entered}`);
  await capture(page, '02-inside-shelter-block.png');
  const sheepContact = await move(['w', 'a'], 5); // -X, towards sheep 1.
  const sheepDistance = Math.hypot(sheepContact[0] + 6.1, sheepContact[2] - 4.35);
  assert.ok(sheepContact[0] < -5.35 && sheepDistance >= 0.8 - 1e-6 && sheepDistance < 0.95,
    `sheep failed to block: ${sheepContact}; distance ${sheepDistance}`);
  await capture(page, '03-sheep-block.png');
  await move(['s', 'd'], 3); // +X to the open aisle.
  const exited = await move(['s', 'a'], 6); // +Z back out, without teleporting.
  assert.ok(exited[2] > 6.8, `sheep trapped the player: ${exited}`);
  await move(['w', 'a'], 4); // -X, line up with the front-left fence.
  const fenceContact = await move(['w', 'd'], 10);
  assert.ok(fenceContact[2] >= 6.53 - 1e-6 && fenceContact[2] < 6.7, `fence failed: ${fenceContact}`);
  await capture(page, '04-front-fence-block.png');

  // Check every sampled position against the actual walking obstacles, not
  // just the final checkpoints, and assert the character stays on the island.
  const obstacles = await page.evaluate(() => window.__ebr70.obstacles);
  for (const [x, y, z] of path) {
    assert.ok(Math.abs(x) <= 7.6 + 1e-6 && Math.abs(z) <= 7.6 + 1e-6 && Math.abs(y - 2.4) < 1e-6);
    for (const obstacle of obstacles) {
      if (obstacle.blocksWalking === false) continue;
      const distance = obstacle.kind === 'circle'
        ? Math.hypot(x - obstacle.x, z - obstacle.z) - obstacle.radius
        : Math.hypot(Math.max(obstacle.minX - x, 0, x - obstacle.maxX), Math.max(obstacle.minZ - z, 0, z - obstacle.maxZ));
      assert.ok(distance >= 0.4 - 1e-5, `${obstacle.name}: player clipped at ${x},${z}`);
    }
  }

  await page.keyboard.press('f');
  const point = await page.evaluate(() => {
    const { camera, character } = window.__ebr70;
    camera.updateMatrixWorld();
    const p = character.position.clone().set(-4.7, 2.4, 4.7).project(camera);
    return { x: (p.x + 1) * 640, y: (1 - p.y) * 360 };
  });
  await page.mouse.move(point.x, point.y);
  assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
  assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
  time += 100;
  await page.evaluate((frameTime) => window.__ebr70Step(frameTime), time);
  await capture(page, '05-pen-placement-rejected.png');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__ebr70.scene.getObjectsByProperty('name', 'placed-fence').length), 0);
  assert.deepEqual(errors, []);
  if (evidence) await writeFile(join(evidence, 'route.json'), `${JSON.stringify({
    viewport: [1280, 720], seed: 123, frontApproach, westRim, behindWest, behindEast, eastFront, openingApproach, entered, sheepContact, sheepDistance,
    exited, fenceContact, sampledFrames: path.length, placementRejected: true, errors,
  }, null, 2)}\n`);
});

test('visual seed reproduces both independent nod phases in the running app', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  async function angles(seed) {
    const { page, errors } = await open(context, seed);
    const result = await page.evaluate(() => [1, 2].map((index) =>
      window.__ebr70.scene.getObjectByName(`sheep-${index}-head-pivot`).rotation.x));
    assert.deepEqual(errors, []);
    await page.close();
    return result;
  }
  const first = await angles(123);
  assert.deepEqual(first, await angles(123));
  assert.notDeepEqual(first, await angles(124));
  assert.notEqual(first[0], first[1]);
});

test('rendered wool remains below all-channel 250 across the day/night and weather matrix', { timeout: 120000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const { page, errors } = await open(context);
  const measurement = await page.evaluate(() => {
    const { scene, camera, character, follow, composer, renderer, dayNight, weather } = window.__ebr70;
    follow(character.position.clone().set(-4.7, 2.4, 4.35));
    camera.zoom = 2.5;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const wool = [];
    scene.traverse((object) => { if (object.name.includes('-wool-')) wool.push(object); });
    if (wool.length !== 6) throw new Error(`Expected six wool lobes, got ${wool.length}`);
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width;
    canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    function read() {
      composer.render(0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    }
    const firstStill = read();
    const stillDifferences = [];
    for (let still = 0; still < 3; still++) {
      const pixels = read();
      let changed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== firstStill[i] || pixels[i + 1] !== firstStill[i + 1] || pixels[i + 2] !== firstStill[i + 2]) changed++;
      }
      stillDifferences.push(changed);
    }
    const result = [];
    function sampleWool(label) {
      wool.forEach((mesh) => { mesh.visible = true; });
      const withWool = read();
      wool.forEach((mesh) => { mesh.visible = false; });
      const withoutWool = read();
      let pixels = 0;
      let blown = 0;
      let maxMinChannel = 0;
      const maxRgb = [0, 0, 0];
      for (let i = 0; i < withWool.length; i += 4) {
        if (withWool[i] === withoutWool[i] && withWool[i + 1] === withoutWool[i + 1] && withWool[i + 2] === withoutWool[i + 2]) continue;
        pixels++;
        const minimum = Math.min(withWool[i], withWool[i + 1], withWool[i + 2]);
        maxMinChannel = Math.max(maxMinChannel, minimum);
        for (let channel = 0; channel < 3; channel++) maxRgb[channel] = Math.max(maxRgb[channel], withWool[i + channel]);
        if (minimum >= 250) blown++;
      }
      result.push({ label, pixels, blown, maxMinChannel, maxRgb });
    }
    dayNight.setDayNightPhase('morning');
    for (let sample = 0; sample < 16; sample++) {
      if (sample) dayNight.update(4.5); // 72-second cycle, including every anchor and midpoint.
      sampleWool(`clear-${sample * 4.5}s`);
    }
    for (const mode of ['cloudy', 'rain']) {
      weather.setWeather(mode);
      weather.update(1.75);
      for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
        dayNight.setDayNightPhase(phase);
        sampleWool(`${mode}-${phase}`);
      }
    }
    wool.forEach((mesh) => { mesh.visible = true; });
    composer.render(0);
    return { samples: result, stillDifferences };
  });
  const { samples, stillDifferences } = measurement;
  assert.deepEqual(stillDifferences, [0, 0, 0], 'static pen flickers between identical renders');
  assert.ok(samples.every(({ pixels }) => pixels > 64), `too few visible wool samples: ${JSON.stringify(samples)}`);
  assert.ok(samples.every(({ blown }) => blown === 0), `blown wool: ${JSON.stringify(samples)}`);
  assert.deepEqual(errors, []);
  if (evidence) await writeFile(join(evidence, 'wool-cycle.json'), `${JSON.stringify({
    visualSeed: 123, rainSeed: 0xeb730001, samples, stillDifferences, errors,
  }, null, 2)}\n`);
});
