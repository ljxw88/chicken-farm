import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// LIGHTING_URL can point at the requested live dev server. Evidence capture is
// opt-in, so the normal browser suite does not rewrite checked-in baselines.
const evidenceDir = process.env.LIGHTING_EVIDENCE_DIR;
const label = process.env.LIGHTING_CAPTURE_LABEL || 'run';
const runFile = promisify(execFile);
let url = process.env.LIGHTING_URL;
let server;
let browser;
const proof = { label, viewport: [1280, 720], phases: {} };

before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  if (!url) {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    url = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch({
    headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  proof.browser = `Chromium ${browser.version()} / SwiftShader`;
});

test('fixed upper-left key follows the specified phase, weather and facing rules', { timeout: 120000 }, async () => {
  // This uses the native-resolution scene and the same screen regions as QA's
  // independent analyzer, while retaining the actual materials and lights.
  const { stdout } = await runFile(process.execPath, ['tools/lighting-probe.mjs'], {
    timeout: 110000, env: { ...process.env, LIGHTING_URL: url, LIGHTING_TUNE: '{}', LIGHTING_PROBE_CAPTURE: '' },
  });
  const metrics = JSON.parse(stdout);
  if (evidenceDir) await writeFile(join(evidenceDir, `${label}-phase-gate.json`), `${JSON.stringify(metrics, null, 2)}\n`);
  const ratios = { 'morning-clear': 0.5, 'day-clear': 0.55, 'sunset-clear': 0.45, 'day-cloudy': 0.7, 'day-rain': 0.75 };
  for (const [name, minRatio] of Object.entries(ratios)) {
    const sample = metrics[name];
    assert.ok(sample.ratio >= minRatio, `${name}: shade/lit ${sample.ratio} is below ${minRatio}`);
    if (name !== 'sunset-clear') assert.ok(sample.asymmetry >= 0.25, `${name}: sunward asymmetry ${sample.asymmetry} < 0.25`);
  }
  assert.ok(metrics['sunset-clear'].bodyToTop <= 0.8, 'sunset body must remain darker than its lit crown');
  for (const [name, sample] of Object.entries(metrics)) {
    assert.ok(Math.abs(sample.lightPosition[0] + 11) < 1e-6 && Math.abs(sample.lightPosition[2] - 4) < 1e-6,
      `${name}: key left its fixed upper-left azimuth`);
    assert.ok(sample.shadowCosine > 0.99, `${name}: shadow points toward the key`);
    // Look Dev's specified daytime offset, halved for cloud and nearly
    // centered in rain, is below QA's independent 0.15-unit C2 threshold.
    // Keep the spec here and report the conflict rather than changing it.
    if (!['day-cloudy', 'day-rain'].includes(name) && sample.lightIntensity >= 0.5) {
      assert.ok(sample.shadowLength >= 0.15, `${name}: shadow offset is too small`);
    }
    assert.ok(sample.min >= 45 && sample.spread <= 0.35, `${name}: unreadable or unstable facing ${JSON.stringify(sample.facings)}`);
    if (name.startsWith('night')) {
      assert.ok(sample.contrast >= 1.3, `${name}: character/ground contrast ${sample.contrast} < 1.30`);
      assert.ok(Object.values(sample.bodyToTopByFacing).every((ratio) => ratio <= 1), `${name}: face brighter than moon-lit top`);
    }
  }
  for (const name of ['morning-clear', 'sunset-clear']) {
    assert.ok(metrics[name].contrast >= 1.3, `${name}: character/ground contrast below 1.30`);
  }
  assert.ok(metrics['morning-clear'].shadowLength > metrics['day-clear'].shadowLength);
  assert.ok(Math.abs(metrics['day-clear'].shadowLength - 0.266) < 0.001);
  assert.ok(Math.abs(metrics['day-cloudy'].shadowLength / metrics['day-clear'].shadowLength - 0.5) < 0.01);
  assert.ok(metrics['day-rain'].shadowLength < metrics['day-cloudy'].shadowLength);
  assert.ok(metrics['day-rain'].shadowOpacity < metrics['day-cloudy'].shadowOpacity);
  assert.ok(metrics['night-clear'].shadowOpacity < metrics['day-clear'].shadowOpacity);
  // Daytime hue separation is reviewed separately if luminance contrast cannot
  // reach 1.30 without abandoning the signed yellow/green palette.
  const hue = ([r, g, b]) => {
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    if (d < 1) return NaN;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (const name of ['day-clear', 'day-cloudy', 'day-rain']) {
    const { bodyRgb, groundRgb } = metrics[name];
    const difference = Math.abs(hue(bodyRgb) - hue(groundRgb));
    assert.ok(Math.min(difference, 360 - difference) >= 5, `${name}: character and adjacent ground lack hue separation`);
  }
  const sunset = metrics['sunset-clear'];
  for (const { rgb } of sunset.grassSamples.slice(1)) {
    assert.ok(rgb[1] >= 1.25 * rgb[0], `sunset grass became olive: ${rgb}`);
  }
  assert.ok(sunset.pond.rgb[2] > sunset.pond.rgb[0] + 5, `sunset pond lost its blue: ${sunset.pond.rgb}`);
  assert.ok(sunset.stream && sunset.stream.rgb[2] > sunset.stream.rgb[0] + 5,
    `sunset stream lost its blue: ${JSON.stringify(sunset.stream)}`);
  assert.ok(sunset.waterfall && sunset.waterfall.rgb[2] > sunset.waterfall.rgb[0] + 5,
    `sunset waterfall lost its blue: ${JSON.stringify(sunset.waterfall)}`);
  const summary = Object.fromEntries(Object.entries(metrics).map(([name, m]) => [name,
    { asymmetry: m.asymmetry, ratio: m.ratio, bodyToTop: m.bodyToTop, contrast: m.contrast, facings: m.facings }]));
  console.log('PHASE_GRAPHICS', JSON.stringify(summary));
});

after(async () => {
  if (evidenceDir) await writeFile(join(evidenceDir, `${label}-measurements.json`), `${JSON.stringify(proof, null, 2)}\n`);
  await browser?.close();
  await server?.close();
});

async function openPhase(context, phase) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  // Test-only access to the real app scene. No production debug globals or
  // substitute materials/lights are used.
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__lightingTest = { scene, camera, character, stairs, controls, follow, renderer, composer, dayNight };\n` });
  });
  await page.goto(`${url}/?phase=${phase}&weather=clear`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__lightingTest && window.getPixelRendering?.().canvasWidth));
  await page.evaluate(() => {
    const { renderer, composer } = window.__lightingTest;
    renderer.setAnimationLoop(null);
    composer.render(0);
  });
  return { page, errors };
}

async function capture(page, phase) {
  if (!evidenceDir) return;
  const screenshot = await page.screenshot();
  await writeFile(join(evidenceDir, `${label}-${phase}-full.png`), screenshot);
  // A genuine center crop of that same frame, enlarged with nearest-neighbor:
  // 256×144 source pixels -> 1280×720. No camera or lighting is changed.
  const base64 = await page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 512, 288, 256, 144, 0, 0, 1280, 720);
    return canvas.toDataURL('image/png').split(',')[1];
  }, screenshot.toString('base64'));
  await writeFile(join(evidenceDir, `${label}-${phase}-character.png`), Buffer.from(base64, 'base64'));
}

async function captureBacklit(page, phase) {
  if (!evidenceDir) return;
  await page.evaluate((phase) => {
    const { scene, camera, renderer, composer, dayNight } = window.__lightingTest;
    const light = scene.getObjectByName('day-night-directional');
    light.position.set(-12, phase === 'daytime' ? 12 : 3, -12);
    dayNight.updateCharacterShadow?.();
    camera.zoom = 3;
    camera.updateProjectionMatrix();
    renderer.setAnimationLoop(null);
    composer.render(0);
  }, phase);
  await page.screenshot({ path: join(evidenceDir, `${label}-${phase}-backlit.png`) });
}

async function measurePhase(page, phase) {
  return page.evaluate(async (phase) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { scene, camera, character, renderer, composer } = window.__lightingTest;
    const light = scene.getObjectByName('day-night-directional');
    const shadow = character.getObjectByName('character-shadow');
    const body = character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
    const width = renderer.domElement.width;
    const height = renderer.domElement.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const luminance = (pixels, offset) => 0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2];
    const renderPixels = () => {
      composer.render(0);
      context.clearRect(0, 0, width, height);
      context.drawImage(renderer.domElement, 0, 0);
      return context.getImageData(0, 0, width, height).data;
    };
    const screen = (point) => {
      point = point.clone().project(camera);
      return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
    };
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    const actualLightPosition = light.position.toArray();

    // Isolate only the shadow's contribution by rendering exactly the same
    // scene with/without its existing mesh. Hide body, face and lantern in
    // both renders; use the weighted centroid of the darkened *pixels*.
    const visible = character.children.map((child) => child.visible);
    for (const child of character.children) if (child !== shadow) child.visible = false;
    shadow.visible = true;
    const withShadow = renderPixels();
    shadow.visible = false;
    const withoutShadow = renderPixels();
    shadow.visible = true;
    character.children.forEach((child, index) => { child.visible = visible[index]; });
    const foot = screen(character.localToWorld(new THREE.Vector3(0, shadow.position.y, 0)));
    const lightWorld = light.getWorldPosition(new THREE.Vector3());
    const targetWorld = light.target.getWorldPosition(new THREE.Vector3());
    const towardSun = lightWorld.sub(targetWorld).setY(0).normalize();
    const origin = character.getWorldPosition(new THREE.Vector3());
    const sunScreen = screen(origin.clone().add(towardSun));
    const originScreen = screen(origin);
    const sunX = sunScreen.x - originScreen.x;
    const sunY = sunScreen.y - originScreen.y;
    const sunLength = Math.hypot(sunX, sunY);
    let mass = 0;
    let weightedX = 0;
    let weightedY = 0;
    let shadowPixels = 0;
    let brightenedPixels = 0;
    for (let y = Math.max(0, Math.floor(foot.y - 30)); y < Math.min(height, Math.ceil(foot.y + 30)); y++) {
      for (let x = Math.max(0, Math.floor(foot.x - 30)); x < Math.min(width, Math.ceil(foot.x + 30)); x++) {
        const offset = (y * width + x) * 4;
        const darkness = luminance(withoutShadow, offset) - luminance(withShadow, offset);
        if (darkness < -1) brightenedPixels++;
        if (darkness <= 1) continue;
        mass += darkness;
        weightedX += (x + 0.5) * darkness;
        weightedY += (y + 0.5) * darkness;
        shadowPixels++;
      }
    }
    const centroid = { x: weightedX / mass, y: weightedY / mass };
    const shadowTowardSun = ((centroid.x - foot.x) * sunX + (centroid.y - foot.y) * sunY) / sunLength;

    // Controlled horizontal azimuths are perpendicular to the fixed
    // isometric camera. Zoom only for this measurement to give the real body
    // enough 4-CSS-px samples; the light, camera pose, materials and renderer
    // are otherwise unchanged. The ordinary full-frame captures above use the
    // normal game zoom. Omit face/lantern pixels by raycasting, then classify
    // the cylindrical mid-body by its outward world-space radial normal.
    const originalZoom = camera.zoom;
    camera.zoom = 3;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const bodyCenter = character.getWorldPosition(new THREE.Vector3());
    const bodyScreen = screen(body.getWorldPosition(new THREE.Vector3()));
    const samples = [];
    for (const sign of [-1, 1]) {
      const lightHeight = phase === 'daytime' ? 12 : 3;
      light.position.set(sign * 12, lightHeight, -sign * 12);
      scene.updateMatrixWorld(true);
      const pixels = renderPixels();
      const sun = light.position.clone().sub(light.target.position).setY(0).normalize();
      const sunward = [];
      const away = [];
      for (let y = Math.max(0, Math.floor(bodyScreen.y - 35)); y < Math.min(height, Math.ceil(bodyScreen.y + 35)); y++) {
        for (let x = Math.max(0, Math.floor(bodyScreen.x - 35)); x < Math.min(width, Math.ceil(bodyScreen.x + 35)); x++) {
          pointer.set((x + 0.5) / width * 2 - 1, 1 - (y + 0.5) / height * 2);
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObject(character, true)[0];
          if (!hit || hit.object !== body) continue;
          const localHeight = hit.point.y - bodyCenter.y;
          if (localHeight < 0.44 || localHeight > 0.96) continue;
          const radial = hit.point.clone().sub(bodyCenter).setY(0).normalize();
          const facing = radial.dot(sun);
          const value = luminance(pixels, (y * width + x) * 4);
          if (facing > 0.3) sunward.push(value);
          if (facing < -0.3) away.push(value);
        }
      }
      const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
      const lit = average(sunward);
      const dark = average(away);
      samples.push({ lightPosition: light.position.toArray(), sunward: lit, away: dark,
        difference: lit - dark, ratio: dark / lit, sunwardPixels: sunward.length, awayPixels: away.length });
    }
    // Hold the camera and body pixels fixed, then put the sun directly behind
    // and in front of the character relative to the camera. This explicitly
    // detects the reported front-bright-when-backlit case.
    const frontSamples = [];
    let nightLantern;
    for (const sign of [-1, 1]) {
      const lightHeight = phase === 'daytime' ? 12 : 3;
      light.position.set(sign * 12, lightHeight, sign * 12);
      scene.updateMatrixWorld(true);
      const pixels = renderPixels();
      const values = [];
      const offsets = [];
      for (let y = Math.max(0, Math.floor(bodyScreen.y - 35)); y < Math.min(height, Math.ceil(bodyScreen.y + 35)); y++) {
        for (let x = Math.max(0, Math.floor(bodyScreen.x - 35)); x < Math.min(width, Math.ceil(bodyScreen.x + 35)); x++) {
          pointer.set((x + 0.5) / width * 2 - 1, 1 - (y + 0.5) / height * 2);
          raycaster.setFromCamera(pointer, camera);
          const hit = raycaster.intersectObject(character, true)[0];
          if (!hit || hit.object !== body) continue;
          const localHeight = hit.point.y - bodyCenter.y;
          if (localHeight < 0.44 || localHeight > 0.96) continue;
          const radial = hit.point.clone().sub(bodyCenter).setY(0).normalize();
          if ((radial.x + radial.z) / Math.SQRT2 < 0.5) continue;
          const offset = (y * width + x) * 4;
          offsets.push(offset);
          values.push(luminance(pixels, offset));
        }
      }
      frontSamples.push({ lightPosition: light.position.toArray(),
        luminance: values.reduce((sum, value) => sum + value, 0) / values.length, pixels: values.length });
      if (phase === 'night' && sign === -1) {
        const lantern = character.getObjectByName('lantern-light');
        const intensity = lantern.intensity;
        lantern.intensity = 0;
        const withoutLantern = renderPixels();
        lantern.intensity = intensity;
        nightLantern = { intensity, withLantern: frontSamples.at(-1).luminance,
          withoutLantern: offsets.reduce((sum, offset) => sum + luminance(withoutLantern, offset), 0) / offsets.length };
      }
    }
    light.position.fromArray(actualLightPosition);
    camera.zoom = originalZoom;
    camera.updateProjectionMatrix();
    composer.render(0);
    return { lightPosition: actualLightPosition, buffer: [width, height],
      shadow: { foot, centroid, towardSunPixels: shadowTowardSun, shadowPixels, brightenedPixels }, samples,
      backlitFront: frontSamples[0], frontlitFront: frontSamples[1],
      backlitRatio: frontSamples[0].luminance / frontSamples[1].luminance, nightLantern };
  }, phase);
}

test('directional character shading and visible shadow follow the key light', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  for (const phase of ['daytime', 'sunset', 'night']) {
    const { page, errors } = await openPhase(context, phase);
    await capture(page, phase);
    proof.phases[phase] = await measurePhase(page, phase);
    await captureBacklit(page, phase);
    proof.phases[phase].errors = errors;
    await page.close();
  }
  console.log(`LIGHTING_MEASUREMENTS ${JSON.stringify(proof.phases)}`);
  await t.test('sun-facing body is brighter, including when the sun is behind the camera-facing front', () => {
    for (const phase of ['daytime', 'sunset']) {
      const result = proof.phases[phase];
      for (const sample of result.samples) {
        assert.ok(sample.sunwardPixels >= 10 && sample.awayPixels >= 10, `${phase}: too few unobstructed body pixels`);
        assert.ok(sample.difference >= 18 && sample.ratio <= 0.78,
          `${phase}: sunward body must be clearly brighter than away-facing body: ${JSON.stringify(sample)}`);
      }
      assert.ok(result.backlitFront.pixels >= 20 && result.frontlitFront.pixels === result.backlitFront.pixels);
      assert.ok(result.backlitRatio <= 0.72,
        `${phase}: camera-facing body is too bright when the sun is behind it: ${result.backlitRatio}`);
    }
    const night = proof.phases.night;
    assert.ok(night.backlitRatio <= 0.72, `night: lantern overwhelms the backlit body: ${night.backlitRatio}`);
    const lanternLift = night.nightLantern.withLantern - night.nightLantern.withoutLantern;
    assert.ok(lanternLift > 1 && lanternLift < 22, `night: lantern should be a small local fill: ${lanternLift}`);
  });
  await t.test('the visible shadow is opposite the actual phase sun or moon', () => {
    for (const phase of ['daytime', 'sunset', 'night']) {
      const result = proof.phases[phase];
      assert.deepEqual(result.buffer, [320, 180]);
      assert.deepEqual(result.errors, []);
      assert.ok(result.shadow.shadowPixels >= 3, `${phase}: no visible dark character shadow`);
      assert.equal(result.shadow.brightenedPixels, 0, `${phase}: a shadow must not brighten its ground`);
      assert.ok(result.shadow.towardSunPixels < -0.5,
        `${phase}: shadow centroid must be opposite the sun by >0.5 render pixels: ${result.shadow.towardSunPixels}`);
    }
  });
  await t.test('a sunset shadow does not extend into the void at the foot-pad edge', async () => {
    const { page, errors } = await openPhase(context, 'sunset');
    await page.evaluate(() => {
      const s = window.__lightingTest;
      const pad = s.stairs.footPad;
      s.character.position.set(pad.position.x + pad.geometry.parameters.width / 2 - 0.4,
        pad.position.y + pad.geometry.parameters.height / 2, pad.position.z);
      s.controls.update(0);
      s.dayNight.updateCharacterShadow?.();
      s.follow(s.character.position);
      s.camera.zoom = 3;
      s.camera.updateProjectionMatrix();
      s.composer.render(0);
    });
    if (evidenceDir) await page.screenshot({ path: join(evidenceDir, `${label}-stairs-edge.png`) });
    proof.padEdge = await page.evaluate(() => {
      const { character, renderer, composer } = window.__lightingTest;
      const shadow = character.getObjectByName('character-shadow');
      for (const child of character.children) if (child !== shadow) child.visible = false;
      const canvas = document.createElement('canvas');
      canvas.width = renderer.domElement.width;
      canvas.height = renderer.domElement.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const pixels = (visible) => {
        shadow.visible = visible;
        composer.render(0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(renderer.domElement, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const withShadow = pixels(true);
      const withoutShadow = pixels(false);
      let changedVoidPixels = 0;
      for (let i = 0; i < withoutShadow.length; i += 4) {
        if (withoutShadow[i] === 16 && withoutShadow[i + 1] === 20 && withoutShadow[i + 2] === 22 &&
            (withShadow[i] !== 16 || withShadow[i + 1] !== 20 || withShadow[i + 2] !== 22)) changedVoidPixels++;
      }
      return { changedVoidPixels, shadowScale: shadow.scale.toArray() };
    });
    assert.deepEqual(errors, []);
    assert.equal(proof.padEdge.changedVoidPixels, 0, 'shadow must not draw over #101416 void');
    await page.close();
  });
  await t.test('the player shadow stays on the raised bridge deck', async () => {
    const { page, errors } = await openPhase(context, 'sunset');
    const result = await page.evaluate(() => {
      const { scene, character, controls, dayNight } = window.__lightingTest;
      if (!scene.getObjectByName('farm-wooden-bridge')) throw new Error('Bridge missing from the playable scene');
      character.position.set(3.9, 2.52, -1.95);
      controls.update(0);
      dayNight.updateCharacterShadow?.();
      scene.updateMatrixWorld(true);
      const shadow = character.getObjectByName('character-shadow');
      const points = shadow.geometry.getAttribute('position');
      let outside = 0;
      for (let i = 0; i < points.count; i++) {
        const point = shadow.localToWorld(character.position.clone().fromBufferAttribute(points, i));
        if (point.x < 2.9 - 1e-6 || point.x > 4.9 + 1e-6 || point.z < -2.65 - 1e-6 || point.z > -1.25 + 1e-6) outside++;
      }
      return { outside, height: character.position.y, shadow: shadow.position.toArray() };
    });
    assert.deepEqual(errors, []);
    assert.ok(result.height > 2.4, 'character was not standing on the deck');
    assert.equal(result.outside, 0, 'player shadow projects off the raised bridge deck');
    await page.close();
  });
});
