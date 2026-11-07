import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { deltaE76 } from '../../tools/assetgen/color.js';

let server;
let browser;
let url;

before(async () => {
  server = await createServer({ configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  url = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openScene() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr89Step = (time) => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      if (!pending.length) throw new Error('No scheduled animation frame');
      for (const callback of pending) callback(time);
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr89 = context;\n` });
  });
  await page.goto(`${url}/?phase=daytime&weather=clear&seed=123`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => Boolean(window.__ebr89 && window.getPixelRendering?.().canvasWidth)));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__ebr89Step(0));
  return { context, page, errors };
}

test('comb and wings remain legible at game resolution inside the original body silhouette', { timeout: 90000 }, async (t) => {
  const { context, page, errors } = await openScene();
  t.after(() => context.close());
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { scene, character, renderer, composer, dayNight } = window.__ebr89;
    const body = character.children.find((object) => object.geometry?.type === 'CapsuleGeometry');
    const parts = ['character-comb', 'character-wing-left', 'character-wing-right'].map((name) => body.getObjectByName(name));
    if (parts.some((part) => !part)) throw new Error('Missing character detail');
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = () => {
      composer.render(0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const diff = (a, b, mask) => {
      let changed = 0, outside = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
        changed++;
        if (!mask[i] && !mask[i + 1] && !mask[i + 2]) outside++;
      }
      return { changed, outside };
    };
    const byPhase = {};
    const visibleCounts = [0, 0, 0];
    const wingSamples = { daytime: [], sunset: [], night: [] };
    for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
      dayNight.setDayNightPhase(phase);
      byPhase[phase] = [];
      for (let angle = 0; angle < 8; angle++) {
        character.rotation.y = angle * Math.PI / 4;
        dayNight.updateCharacterShadow();
        parts.forEach((part) => { part.visible = true; });
        const withDetails = pixels();
        parts.forEach((part) => { part.visible = false; });
        const withoutDetails = pixels();

        // Render just the unmodified capsule, at this exact pose, into an
        // independent mask. No hand-drawn bounding rectangle is allowed.
        const sceneVisibility = scene.children.map((object) => object.visible);
        const characterVisibility = character.children.map((object) => object.visible);
        const background = scene.background, fog = scene.fog, material = body.material;
        const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
        scene.children.forEach((object) => { object.visible = object === character; });
        character.children.forEach((object) => { object.visible = object === body; });
        scene.background = new THREE.Color(0); scene.fog = null; body.material = white;
        const mask = pixels();
        body.material = material; white.dispose(); scene.background = background; scene.fog = fog;
        scene.children.forEach((object, i) => { object.visible = sceneVisibility[i]; });
        character.children.forEach((object, i) => { object.visible = characterVisibility[i]; });

        byPhase[phase].push(diff(withDetails, withoutDetails, mask));
        if (phase === 'daytime' || (phase !== 'morning' && [1, 2, 5, 6].includes(angle))) {
          for (const [index, part] of parts.entries()) {
            if (phase !== 'daytime' && index === 0) continue;
            part.visible = true;
            const withPart = pixels();
            if (phase === 'daytime') visibleCounts[index] += diff(withPart, withoutDetails, mask).changed;
            if (index > 0 && phase !== 'morning' && [1, 2, 5, 6].includes(angle)) {
              const samples = [];
              for (let i = 0; i < withPart.length; i += 4) {
                if (withPart[i] === withoutDetails[i] && withPart[i + 1] === withoutDetails[i + 1] &&
                    withPart[i + 2] === withoutDetails[i + 2]) continue;
                samples.push({ body: [...withoutDetails.slice(i, i + 3)], wing: [...withPart.slice(i, i + 3)] });
              }
              if (samples.length) wingSamples[phase].push({ side: part.name, angle, samples });
            }
            part.visible = false;
          }
        }
      }
    }
    return { size: [canvas.width, canvas.height], byPhase, visibleCounts, wingSamples };
  });
  assert.deepEqual(result.size, [320, 180]);
  for (const [phase, frames] of Object.entries(result.byPhase)) {
    assert.ok(frames.some(({ changed }) => changed > 0), `${phase}: no detail pixels`);
    assert.ok(frames.every(({ outside }) => outside === 0), `${phase}: details left the original body silhouette: ${JSON.stringify(frames)}`);
  }
  assert.ok(result.visibleCounts.every((count) => count > 0), `comb/wing missing from rendered facings: ${result.visibleCounts}`);
  const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  for (const [phase, views] of Object.entries(result.wingSamples)) {
    for (const side of ['character-wing-left', 'character-wing-right']) {
      assert.ok(views.some((view) => view.side === side && view.samples.length >= 2), `${phase}: ${side} is not visible`);
    }
    const samples = views.flatMap((view) => view.samples);
    const meanDeltaE = samples.reduce((sum, sample) => sum + deltaE76(sample.body, sample.wing), 0) / samples.length;
    const minLumaDelta = Math.min(...views.map(({ samples }) => Math.abs(samples.reduce((sum, sample) =>
      sum + luma(sample.body) - luma(sample.wing), 0) / samples.length)));
    assert.ok(meanDeltaE >= 4.8, `${phase}: wing/body ΔE ${meanDeltaE} is too low`);
    assert.ok(minLumaDelta >= 3.5, `${phase}: a visible wing has only ${minLumaDelta} luminance separation`);
    t.diagnostic(`${phase} wing/body: mean pixel ΔE ${meanDeltaE.toFixed(2)}, minimum view ΔY ${minLumaDelta.toFixed(2)}`);
  }
  assert.deepEqual(errors, []);
});

test('the EBR-92 body crown, shade shader and lantern wing remain unchanged in the browser', { timeout: 30000 }, async (t) => {
  const { context, page, errors } = await openScene();
  t.after(() => context.close());
  const actual = await page.evaluate(() => {
    const { character, dayNight, weather } = window.__ebr89;
    const body = character.children.find((object) => object.geometry?.type === 'CapsuleGeometry');
    const values = () => {
      const colors = [...body.geometry.getAttribute('color').array];
      return { min: Math.min(...colors), max: Math.max(...colors) };
    };
    const clearDay = values();
    weather.setWeather('cloudy'); weather.update(1.75);
    const cloudyDay = values();
    weather.setWeather('clear'); weather.update(1.75);
    dayNight.setDayNightPhase('night');
    const night = values();
    const shader = { fragmentShader: '#include <lights_fragment_begin>\n#include <opaque_fragment>', uniforms: {} };
    body.material.onBeforeCompile(shader, {});
    const wing = character.getObjectByName('lantern-wing');
    return { color: body.material.color.getHex(), emissive: body.material.emissive.getHex(), clearDay, cloudyDay, night,
      shader: shader.fragmentShader, lantern: { parent: wing.parent.name, radius: wing.geometry.parameters.radius,
        color: wing.material.color.getHex(), emissive: wing.material.emissive.getHex() } };
  });
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  assert.equal(actual.color, 0xffd477);
  assert.equal(actual.emissive, 0);
  near(actual.clearDay.min, 1.08);
  near(actual.clearDay.max / actual.clearDay.min, 1.28);
  near(actual.cloudyDay.min, 1);
  near(actual.cloudyDay.max, 1.28);
  near(actual.night.min, 1);
  near(actual.night.max, 1.15);
  for (const expression of ['vec3( 3.00, 0.00, 0.00 )', 'vec3( 4.50, 2.80, 0.80 )',
    '0.30 * shade', '0.03 * shade', '0.30 * shade * ( 1.0 - daytime )']) {
    assert.ok(actual.shader.includes(expression), `EBR-92 shade shader lost ${expression}`);
  }
  assert.deepEqual(actual.lantern, { parent: 'lantern', radius: 0.08, color: 0xffd477, emissive: 0 });
  assert.deepEqual(errors, []);
});

test('the signed daytime mean body-to-ground contrast still passes in clear and rain', { timeout: 60000 }, async (t) => {
  const { context, page, errors } = await openScene();
  t.after(() => context.close());
  const metrics = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { scene, camera, character, follow, renderer, composer, dayNight, weather } = window.__ebr89;
    const body = character.children.find((object) => object.geometry?.type === 'CapsuleGeometry');
    // EBR-92's repeatable away pose: compare visible mean body pixels with a
    // 0.7..1.5-unit annulus of visible grass/path, not QA's unrelated medians.
    character.position.set(-0.577636, 2.4, -0.577636);
    character.rotation.y = -3 * Math.PI / 4;
    follow(character.position);
    dayNight.updateCharacterShadow();
    window.setPixelRendering(false);
    scene.getObjectByName('weather-rain').visible = false;
    camera.updateMatrixWorld(); scene.updateMatrixWorld(true);
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = () => {
      composer.render(0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), origin = character.position;
    const visible = (object) => {
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return false;
      return true;
    };
    const samples = new Map();
    for (let ix = -15; ix <= 15; ix++) for (let iz = -15; iz <= 15; iz++) {
      const distance = Math.hypot(ix, iz) / 10;
      if (distance < 0.7 || distance > 1.5) continue;
      const p = new THREE.Vector3(origin.x + ix / 10, origin.y + 0.03, origin.z + iz / 10).project(camera);
      const x = Math.floor((p.x + 1) * canvas.width / 2), y = Math.floor((1 - p.y) * canvas.height / 2);
      if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;
      pointer.set((x + 0.5) / canvas.width * 2 - 1, 1 - (y + 0.5) / canvas.height * 2);
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(scene.children, true).find(({ object }) =>
        object.isMesh && visible(object) && object.geometry.type !== 'CircleGeometry');
      if (!hit || !(hit.object.name === 'island-top' || hit.object.name.startsWith('farm-path-'))) continue;
      const groundDistance = Math.hypot(hit.point.x - origin.x, hit.point.z - origin.z);
      if (groundDistance >= 0.7 && groundDistance <= 1.5) samples.set(`${x},${y}`, [x, y]);
    }
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((value) => (value / 255) ** 2.2);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const lab = (rgb) => {
      const [r, g, b] = rgb.map((value) => (value / 255) ** 2.2);
      const f = (x) => x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
      const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
      const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
      const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
    };
    const results = {};
    for (const mode of ['clear', 'rain']) {
      weather.setWeather(mode); weather.update(1.75);
      body.visible = true;
      const frame = pixels();
      body.visible = false;
      const noBody = pixels();
      body.visible = true;
      const bodySum = [0, 0, 0], groundSum = [0, 0, 0];
      let bodyPixels = 0;
      for (let i = 0; i < frame.length; i += 4) {
        if (frame[i] === noBody[i] && frame[i + 1] === noBody[i + 1] && frame[i + 2] === noBody[i + 2]) continue;
        for (let c = 0; c < 3; c++) bodySum[c] += frame[i + c];
        bodyPixels++;
      }
      for (const [x, y] of samples.values()) {
        const offset = (y * canvas.width + x) * 4;
        for (let c = 0; c < 3; c++) groundSum[c] += frame[offset + c];
      }
      const bodyRgb = bodySum.map((value) => value / bodyPixels);
      const groundRgb = groundSum.map((value) => value / samples.size);
      const a = luminance(bodyRgb), b = luminance(groundRgb);
      const bodyLab = lab(bodyRgb), groundLab = lab(groundRgb);
      results[mode] = { bodyRgb, groundRgb, bodyPixels, groundSamples: samples.size,
        contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        deltaE: Math.hypot(...bodyLab.map((value, i) => value - groundLab[i])) };
    }
    return results;
  });
  for (const [mode, sample] of Object.entries(metrics)) {
    assert.ok(sample.bodyPixels > 100 && sample.groundSamples > 40, `${mode}: too few visible pixels`);
    assert.ok(sample.contrast >= 1.15 || sample.deltaE >= 25, `${mode}: mean contrast failed: ${JSON.stringify(sample)}`);
  }
  t.diagnostic(`EBR-92 mean contrast: ${JSON.stringify(metrics)}`);
  assert.deepEqual(errors, []);
});
