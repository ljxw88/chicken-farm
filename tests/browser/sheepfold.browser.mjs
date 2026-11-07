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

async function open(context, seed = 123, phase = 'daytime', hideSky = false) {
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
    assert.equal((body.match(/random:\s*createVisualRandom\(visualSeed\)/g) ?? []).length, 1);
    await route.fulfill({ response, body: `${body.replace(/random:\s*createVisualRandom\(visualSeed\)/, 'random: window.__ebr70RainRandom')}
window.__ebr70 = { scene, camera, character, obstacles, follow, composer, renderer, dayNight, weather, engine, environment, sheepfold };\n` });
  });
  await page.goto(`${url}/?phase=${phase}&weather=clear&seed=${seed}${hideSky ? '&skyhud=0' : ''}`, { waitUntil: 'networkidle' });
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

test('visual seed reproduces independent sheep nods and both effects in the running app', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  async function sample(seed) {
    const { page, errors } = await open(context, seed);
    const result = await page.evaluate(() => {
      const { scene } = window.__ebr70;
      const smoke = scene.getObjectByName('chimney-smoke');
      const flies = scene.getObjectByName('night-fireflies');
      return { angles: [1, 2].map((index) => scene.getObjectByName(`sheep-${index}-head-pivot`).rotation.x),
        smoke: smoke.children.map((puff) => [puff.visible, ...puff.position.toArray(), puff.scale.x, puff.rotation.y, puff.material.opacity]),
        fireflies: Array.from(flies.instanceMatrix.array) };
    });
    assert.deepEqual(errors, []);
    await page.close();
    return result;
  }
  const first = await sample(123);
  assert.deepEqual(first, await sample(123));
  const different = await sample(124);
  for (const field of ['angles', 'smoke', 'fireflies']) assert.notDeepEqual(first[field], different[field], field);
  assert.notEqual(first.angles[0], first.angles[1]);
});

test('showing or hiding the sky HUD preserves the seeded sheepfold and effects', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const samples = [];
  for (const hideSky of [false, true]) {
    const { page, errors } = await open(context, 123, 'night', hideSky);
    await page.evaluate(() => window.__ebr70Step(1000));
    const sample = () => page.evaluate(() => {
      const { scene, sheepfold, weather } = window.__ebr70;
      const smoke = scene.getObjectByName('chimney-smoke');
      const flies = scene.getObjectByName('night-fireflies');
      return { foldVisible: sheepfold.group.visible, obstacles: sheepfold.obstacles,
        sheep: [1, 2].map((index) => ({
          position: scene.getObjectByName(`sheep-${index}`).position.toArray(),
          nod: scene.getObjectByName(`sheep-${index}-head-pivot`).rotation.x,
          shadow: scene.getObjectByName(`sheep-${index}-shadow`).position.toArray(),
        })), weather: weather.getWeather(),
        smoke: smoke.children.map((puff) => [puff.visible, ...puff.position.toArray(), puff.material.opacity]),
        fireflies: Array.from(flies.geometry.getAttribute('instanceOpacity').array) };
    });
    const before = await sample();
    assert.equal(before.foldVisible, true);
    assert.equal(before.obstacles.length, 13);
    assert.equal(before.sheep.length, 2);
    assert.equal(before.fireflies.filter((opacity) => opacity > 0).length, 14);
    assert.equal(await page.locator('#hud').count(), hideSky ? 0 : 1);
    if (!hideSky) {
      await page.evaluate(() => document.querySelector('[data-action="sky"]').click());
      assert.equal(await page.locator('#sky-panel').isVisible(), true);
      assert.deepEqual(await sample(), before);
    }
    samples.push(before);
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.deepEqual(samples[0], samples[1]);
});

test('the engine owns every fold obstacle and advances sheep and shared environment shadows', { timeout: 45000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const { page, errors } = await open(context);
  const sample = () => page.evaluate(() => {
    const { scene, engine, environment, sheepfold } = window.__ebr70;
    const entities = [...engine.world.with('obstacle')];
    const fold = entities.filter(({ obstacle }) => obstacle.name.startsWith('sheepfold-') || /^sheep-\d+$/.test(obstacle.name));
    const shadow = (name) => {
      const object = scene.getObjectByName(name);
      return { position: object.position.toArray(), opacity: object.material.opacity };
    };
    return {
      obstacles: fold.map(({ obstacle }) => obstacle),
      eachMirroredOnce: sheepfold.obstacles.every((obstacle) => entities.filter((entity) => entity.obstacle === obstacle).length === 1),
      sharedDayNight: [...engine.world.with('dayNight')].some((entity) => entity.dayNight === environment.dayNight),
      sharedWeather: [...engine.world.with('weather')].some((entity) => entity.weather === environment.weather),
      clock: { ...environment.dayNight }, weather: window.getWeather(),
      phase: document.querySelector('[data-phase]').textContent,
      angles: [1, 2].map((index) => scene.getObjectByName(`sheep-${index}-head-pivot`).rotation.x),
      farmShadow: shadow('cottage-shadow'), fenceShadow: shadow('sheepfold-fence-1-shadow'),
      shelterShadow: shadow('sheepfold-lean-to-shadow'), sheepShadow: shadow('sheep-1-shadow'),
    };
  });
  const day = await sample();
  assert.equal(day.obstacles.length, 13);
  assert.equal(day.eachMirroredOnce, true);
  assert.equal(day.sharedDayNight, true);
  assert.equal(day.sharedWeather, true);
  assert.deepEqual(day.obstacles.filter((item) => item.name.startsWith('sheepfold-fence-')).map((item) => item.name).sort(),
    Array.from({ length: 9 }, (_, index) => `sheepfold-fence-${index + 1}`));
  const shelter = day.obstacles.find((item) => item.name === 'sheepfold-lean-to');
  assert.equal(shelter.kind, 'box');
  assert.ok(Math.abs(shelter.maxX - shelter.minX - 1.4) < 1e-9);
  assert.ok(Math.abs(shelter.maxZ - shelter.minZ - 1.2) < 1e-9);
  for (const [index, x] of [[1, -6.1], [2, -3.3]]) {
    const sheep = day.obstacles.find((item) => item.name === `sheep-${index}`);
    assert.equal(sheep.kind, 'circle');
    assert.ok(Math.abs(sheep.x - x) < 1e-9 && Math.abs(sheep.z - 4.35) < 1e-9);
    assert.equal(sheep.radius, 0.4);
  }
  const reserve = day.obstacles.find((item) => item.name === 'sheepfold-placement');
  assert.equal(reserve.kind, 'box');
  assert.equal(reserve.blocksWalking, false);
  assert.ok(Math.abs(reserve.minX + 6.95) < 1e-9 && Math.abs(reserve.maxX + 2.45) < 1e-9);
  assert.ok(Math.abs(reserve.minZ - 3.1) < 1e-9 && Math.abs(reserve.maxZ - 6.1) < 1e-9);
  assert.equal(day.clock.held, true);
  assert.equal(day.clock.cycleSeconds, 1440);

  await page.evaluate(() => window.__ebr70Step(1000));
  const held = await sample();
  assert.equal(held.clock.progress, day.clock.progress, 'URL-pinned engine phase must remain held');
  assert.ok(held.angles.every((angle, index) => Math.abs(angle - day.angles[index]) > 1e-3),
    'both seeded heads must animate while the phase is held');
  await page.evaluate(() => {
    window.setDayNightPhase('night');
    window.setWeather('rain');
    window.__ebr70Step(2750);
  });
  const nightRain = await sample();
  assert.equal(nightRain.clock.held, false);
  assert.ok(Math.abs(nightRain.clock.progress - (0.75 + 1.75 / day.clock.cycleSeconds)) < 1e-9);
  assert.deepEqual(nightRain.weather, { mode: 'rain', rainAmount: 1, cloudyAmount: 0 });
  assert.match(nightRain.phase.toLowerCase(), /night/);
  for (const name of ['farmShadow', 'fenceShadow', 'shelterShadow', 'sheepShadow']) {
    assert.ok(nightRain[name].opacity < day[name].opacity, `${name} did not respond to night and rain`);
    assert.notDeepEqual(nightRain[name].position, day[name].position, `${name} did not follow the new shadow offset`);
  }
  assert.ok(Math.abs(nightRain.fenceShadow.opacity - nightRain.farmShadow.opacity) < 1e-9);
  assert.ok(Math.abs(nightRain.shelterShadow.opacity - nightRain.farmShadow.opacity) < 1e-9);
  assert.ok(Math.abs(nightRain.sheepShadow.opacity / nightRain.farmShadow.opacity - 1.5) < 1e-9);
  assert.deepEqual(errors, []);
  if (evidence) await writeFile(join(evidence, 'engine-integration.json'), `${JSON.stringify({ day, held, nightRain, errors }, null, 2)}\n`);
});

test('each sheep has separately readable wool, face and legs at the actual game pixel scale', { timeout: 120000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const proof = { viewport: [1280, 720], buffer: [320, 180], seed: 123, phases: {} };
  for (const phase of ['daytime', 'sunset', 'night']) {
    const { page, errors } = await open(context, 123, phase);
    const samples = [];
    for (const time of [0, 1000, 2000, 3000]) {
      if (time) await page.evaluate((frameTime) => window.__ebr70Step(frameTime), time);
      const measurement = await page.evaluate(() => {
        const { scene, renderer, composer } = window.__ebr70;
        const canvas = document.createElement('canvas');
        canvas.width = renderer.domElement.width;
        canvas.height = renderer.domElement.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const width = canvas.width;
        const height = canvas.height;
        if (width !== 320 || height !== 180) throw new Error(`Wrong pixel buffer: ${width}x${height}`);
        function pixels() {
          composer.render(0);
          context.clearRect(0, 0, width, height);
          context.drawImage(renderer.domElement, 0, 0);
          return context.getImageData(0, 0, width, height).data;
        }
        const normal = pixels();
        const results = [];
        for (const index of [1, 2]) {
          const animal = scene.getObjectByName(`sheep-${index}`);
          const wool = animal.children.filter((mesh) => mesh.name.includes('-wool-'));
          const face = animal.getObjectByName(`sheep-${index}-face`);
          const legs = animal.children.filter((mesh) => mesh.name.endsWith('-leg'));
          if (wool.length !== 3 || legs.length !== 4 || !face) throw new Error(`Incomplete sheep ${index}`);
          function measure(objects) {
            objects.forEach((object) => { object.visible = false; });
            const without = pixels();
            objects.forEach((object) => { object.visible = true; });
            const mask = new Uint8Array(width * height);
            let count = 0; let coolPixels = 0; let minX = width; let minY = height; let maxX = -1; let maxY = -1;
            const rgb = [[], [], []];
            for (let p = 0; p < mask.length; p++) {
              const i = p * 4;
              const change = Math.max(Math.abs(normal[i] - without[i]), Math.abs(normal[i + 1] - without[i + 1]),
                Math.abs(normal[i + 2] - without[i + 2]));
              if (change < 3) continue;
              mask[p] = 1;
              count++;
              if (normal[i + 2] > normal[i] + 2) coolPixels++;
              const x = p % width;
              const y = Math.floor(p / width);
              minX = Math.min(minX, x); maxX = Math.max(maxX, x);
              minY = Math.min(minY, y); maxY = Math.max(maxY, y);
              for (let channel = 0; channel < 3; channel++) rgb[channel].push(normal[i + channel]);
            }
            let maxRun = 0;
            for (let y = 0; y < height; y++) {
              let run = 0;
              for (let x = 0; x < width; x++) {
                run = mask[y * width + x] ? run + 1 : 0;
                maxRun = Math.max(maxRun, run);
              }
            }
            const median = rgb.map((channel) => channel.length
              ? channel.sort((a, b) => a - b)[Math.floor(channel.length / 2)] : null);
            return { count, coolPixels, width: count ? maxX - minX + 1 : 0, height: count ? maxY - minY + 1 : 0,
              maxRun, bounds: count ? [minX, minY, maxX, maxY] : null, median, mask };
          }
          const body = measure(wool);
          const head = measure([face]);
          const allLegs = measure(legs);
          const separateLegs = legs.map((leg) => measure([leg]));
          const exclusive = (part, other) => part.mask.reduce((count, present, i) => count + Number(present && !other.mask[i]), 0);
          head.distinctPixels = exclusive(head, allLegs);
          allLegs.distinctPixels = exclusive(allLegs, head);
          const partCanvas = document.createElement('canvas');
          partCanvas.width = width;
          partCanvas.height = height;
          const partContext = partCanvas.getContext('2d');
          const partImage = partContext.createImageData(width, height);
          for (let p = 0; p < width * height; p++) {
            const i = p * 4;
            // White = wool, red = brown face, cyan = brown legs.
            if (body.mask[p]) partImage.data.set([255, 255, 255], i);
            if (head.mask[p]) partImage.data.set([255, 0, 0], i);
            if (allLegs.mask[p]) partImage.data.set([0, 255, 255], i);
            partImage.data[i + 3] = 255;
          }
          partContext.putImageData(partImage, 0, 0);
          const strip = ({ mask, ...summary }) => summary;
          results.push({ index, yaw: animal.rotation.y, body: strip(body), head: strip(head), legs: strip(allLegs),
            separateLegs: separateLegs.map(strip), partMask: partCanvas.toDataURL('image/png').split(',')[1] });
        }
        composer.render(0);
        return results;
      });
      if (time === 0 && evidence) {
        const cdp = await context.newCDPSession(page);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
        const png = Buffer.from(shot.data, 'base64');
        await writeFile(join(evidence, `visibility-${phase}-full.png`), png);
        await cdp.detach();
        for (const animal of measurement) {
          await writeFile(join(evidence, `visibility-${phase}-sheep-${animal.index}-parts.png`), Buffer.from(animal.partMask, 'base64'));
          const rectangles = [animal.body.bounds, animal.head.bounds, animal.legs.bounds].filter(Boolean);
          const left = Math.max(0, Math.min(...rectangles.map((rect) => rect[0])) - 3);
          const top = Math.max(0, Math.min(...rectangles.map((rect) => rect[1])) - 3);
          const right = Math.min(319, Math.max(...rectangles.map((rect) => rect[2])) + 3);
          const bottom = Math.min(179, Math.max(...rectangles.map((rect) => rect[3])) + 3);
          const rect = [left * 4, top * 4, (right - left + 1) * 4, (bottom - top + 1) * 4];
          animal.crop = { sourceCssPixels: rect, scale: 4 };
          const cropped = await page.evaluate(async ({ base64, rect }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${base64}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = rect[2] * 4;
            canvas.height = rect[3] * 4;
            const context = canvas.getContext('2d');
            context.imageSmoothingEnabled = false;
            context.drawImage(image, ...rect, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png').split(',')[1];
          }, { base64: png.toString('base64'), rect });
          await writeFile(join(evidence, `visibility-${phase}-sheep-${animal.index}-4x.png`), Buffer.from(cropped, 'base64'));
        }
      }
      const animals = measurement.map(({ partMask, ...summary }) => summary);
      console.log('SHEEP_VISIBILITY', phase, time, JSON.stringify(animals.map(({ index, body, head, legs, separateLegs }) => ({
        index, body: [body.count, body.width, body.height, body.median], head: [head.count, head.maxRun],
        legs: [legs.count, legs.maxRun], individualLegRuns: separateLegs.map((leg) => leg.maxRun),
      }))));
      for (const animal of animals) {
        const label = `${phase} t=${time} sheep ${animal.index}`;
        assert.ok(Math.abs(animal.yaw) <= Math.PI / 6 + 1e-6, `${label}: faces away from +Z`);
        assert.ok(animal.body.maxRun >= 3, `${label}: wool not visible: ${JSON.stringify(animal.body)}`);
        assert.ok(animal.body.width > animal.body.height, `${label}: wool does not read as elongated: ${JSON.stringify(animal.body)}`);
        assert.ok(animal.head.maxRun >= 2, `${label}: head narrower than two pixels: ${JSON.stringify(animal.head)}`);
        assert.ok(animal.legs.maxRun >= 2, `${label}: legs narrower than two pixels: ${JSON.stringify(animal.legs)}`);
        assert.ok(animal.separateLegs.filter((leg) => leg.maxRun >= 2).length >= 2,
          `${label}: fewer than two individual legs are two pixels wide: ${JSON.stringify(animal.separateLegs)}`);
        assert.ok(animal.head.distinctPixels >= 2 && animal.legs.distinctPixels >= 2,
          `${label}: head and legs are not separately visible`);
        const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        assert.ok(luminance(animal.head.median) < luminance(animal.body.median) * 0.8,
          `${label}: brown head is not distinct from wool`);
        if (phase === 'night') assert.ok(animal.body.median[0] >= animal.body.median[1] + 2 &&
          animal.body.median[0] >= animal.body.median[2] + 6,
          `${label}: night wool is not warm: ${animal.body.median}`);
        if (phase === 'night') assert.ok(animal.body.coolPixels <= Math.max(1, Math.floor(animal.body.count * 0.1)),
          `${label}: too many blue-dominant wool pixels: ${animal.body.coolPixels}/${animal.body.count}`);
      }
      samples.push({ time, animals });
    }
    assert.deepEqual(errors, []);
    proof.phases[phase] = { samples, errors };
    await page.close();
  }
  if (evidence) await writeFile(join(evidence, 'visibility.json'), `${JSON.stringify(proof, null, 2)}\n`);
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
    // Exercise the original full-cycle sampling at an explicit dev speed;
    // the HUD's honest default remains 1440 seconds.
    window.setDayNightCycleSeconds(72);
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
