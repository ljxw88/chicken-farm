import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const historicalSha = '9e8c8c6c479567fcb4c7796763e86ceb6d6b72a4';
const stairBaselineSha = '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff';
const viewport = { width: 1280, height: 720 };
const seed = 0xeb740001;
const search = '?phase=daytime&weather=clear&skyhud=0';

async function serverAt(root) {
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function open(browser, url) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(({ seed }) => {
    let state = seed >>> 0;
    window.__ebr74RandomCalls = 0;
    window.__ebr74Random = () => {
      window.__ebr74RandomCalls++;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr74Step = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame scheduled');
      for (const callback of current) callback(time);
    };
  }, { seed });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
    await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr74Random,')}
window.__ebr74 = { scene, camera, character, controls, follow, stairs, obstacles, renderer, composer };
` });
  });
  await page.goto(`${url}/${search}`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => window.__ebr74 && window.__ebr74RandomCalls > 0));
  await page.evaluate(() => document.fonts.ready);
  const graphics = await page.evaluate(() => {
    const gl = document.querySelector('#scene').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { webgl: gl?.getParameter(gl.VERSION), renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
      pixel: window.getPixelRendering() };
  });
  assert.match(graphics.webgl, /WebGL 2\.0/);
  assert.match(graphics.renderer, /SwiftShader/i);
  assert.equal(graphics.pixel.enabled, true);
  assert.deepEqual([graphics.pixel.canvasWidth, graphics.pixel.canvasHeight, graphics.pixel.devicePixelRatio], [320, 180, 1]);
  return { context, page, errors };
}

async function capture(context, page) {
  const cdp = await context.newCDPSession(page);
  try {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const bytes = Buffer.from(screenshot.data, 'base64');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [viewport.width, viewport.height]);
    return bytes;
  } finally {
    await cdp.detach();
  }
}

async function perform(fixture, action, trace, frames, bodylessFrames, marks) {
  const { page, context } = fixture;
  if (action.type === 'frames') {
    const states = await page.evaluate((times) => times.map((time) => {
      window.__ebr74Step(time);
      const { character, camera } = window.__ebr74;
      const shadow = character.getObjectByName('character-shadow');
      return { time, position: character.position.toArray(), yaw: character.rotation.y,
        camera: camera.position.toArray(), shadowY: shadow?.position.y ?? null };
    }), action.times);
    trace.push(...states);
  } else if (action.type === 'key') {
    await page.keyboard[action.down ? 'down' : 'up'](action.key);
  } else if (action.type === 'click') {
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, action), 'scene');
    if (action.touch) {
      await page.dispatchEvent('#scene', 'pointerdown', { bubbles: true, cancelable: true, isPrimary: true,
        button: 0, pointerType: 'touch', clientX: action.x, clientY: action.y });
    } else {
      await page.mouse.click(action.x, action.y);
    }
  } else if (action.type === 'blur') {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  } else if (action.type === 'capture') {
    frames[action.name] = await capture(context, page);
    // A character-material ticket may change the visible capsule. Isolate that
    // mesh at the same frozen time so the replay can still demand exact parity
    // for the scene, face, lantern and every pixel outside the body.
    const wasVisible = await page.evaluate(() => {
      const { character, composer } = window.__ebr74;
      const body = character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
      const visible = body.visible;
      body.visible = false;
      composer.render(0);
      return visible;
    });
    try {
      bodylessFrames[action.name] = await capture(context, page);
    } finally {
      await page.evaluate((visible) => {
        const { character, composer } = window.__ebr74;
        character.children.find((child) => child.geometry?.type === 'CapsuleGeometry').visible = visible;
        composer.render(0);
      }, wasVisible);
    }
  } else if (action.type === 'mark') {
    marks[action.name] = await page.evaluate(() => {
      const { scene, character, obstacles } = window.__ebr74;
      const deck = obstacles.find((item) => item.name === 'wooden-bridge');
      const water = obstacles.filter((item) => item.name.startsWith('stream-water-'));
      return {
        position: character.position.toArray(), deck,
        waterCount: water.length,
        boxesInDeck: water.filter((item) => item.minX < deck.maxX && item.maxX > deck.minX &&
          item.minZ < deck.maxZ && item.maxZ > deck.minZ).length,
        gapWidths: [1, 2, 3, 4].map((i) => {
          const gap = scene.getObjectByName(`bridge-gap-${i}`);
          gap.geometry.computeBoundingBox();
          return gap.geometry.boundingBox.max.x - gap.geometry.boundingBox.min.x;
        }),
      };
    });
  } else {
    throw new Error(`Unknown replay action ${action.type}`);
  }
}

async function recordScenario(browser, url, name, replayScript) {
  const fixture = await open(browser, url);
  const { page } = fixture;
  const script = [];
  const trace = [];
  const frames = {};
  const bodylessFrames = {};
  const marks = {};
  const bodyShape = await page.evaluate(() => {
    const body = window.__ebr74.character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
    const geometry = body.geometry;
    return { position: body.position.toArray(), rotation: body.rotation.toArray(), scale: body.scale.toArray(),
      positions: Array.from(geometry.getAttribute('position').array), normals: Array.from(geometry.getAttribute('normal').array),
      indices: Array.from(geometry.index.array), material: { color: body.material.color.getHex(),
        emissive: body.material.emissive.getHex(), roughness: body.material.roughness,
        shadeShader: body.material.onBeforeCompile.toString() } };
  });
  let time = 0;
  async function emit(action) {
    script.push(action);
    await perform(fixture, action, trace, frames, bodylessFrames, marks);
  }
  async function advance(count, delta) {
    const times = Array.from({ length: count }, () => { time += delta; return time; });
    await emit({ type: 'frames', times });
  }
  async function key(key, down) { await emit({ type: 'key', key, down }); }
  async function click(x, z, y = 2.4, touch = false) {
    const point = await page.evaluate(({ x, y, z }) => {
      const { camera, character } = window.__ebr74;
      camera.updateMatrixWorld();
      const p = character.position.clone().set(x, y, z).project(camera);
      const rect = document.querySelector('#scene').getBoundingClientRect();
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    }, { x, y, z });
    await emit({ type: 'click', ...point, touch });
  }
  try {
    if (replayScript) {
      for (const action of replayScript) await perform(fixture, action, trace, frames, bodylessFrames, marks);
    } else {
      await emit({ type: 'frames', times: [0] });
      if (name === 'walking') {
        await emit({ type: 'capture', name: 'spawn' });
        await emit({ type: 'mark', name: 'spawn' });
        await key('s', true);
        await advance(8, 100);
        await emit({ type: 'capture', name: 'walking' });
        await key('s', false);
        await click(0.5, -1);
        await advance(3, 35);
        await key('w', true); // Cancels the click target.
        await advance(4, 17);
        await key('w', false);
        await advance(2, 100);
        await click(1.3, -0.3, 2.4, true);
        await advance(12, 100);
        await key('d', true);
        await key('a', true); // Opposite keys still suppress click-to-move.
        await click(0, 0);
        await advance(2, 80);
        await emit({ type: 'blur' });
        await advance(2, 100);
        await key('d', false);
        await key('a', false);
      } else if (name === 'qa-walk') {
        await key('d', true);
        await advance(20, 100);
        await emit({ type: 'mark', name: 'walkD2s' });
        await key('d', false);
      } else if (name === 'key-transitions') {
        await key('d', true);
        await advance(20, 100);
        await key('d', false);
        await emit({ type: 'mark', name: 'before-single-s' });
        await key('s', true);
        await advance(1, 1000 / 60); // A real frame may occur before the second keydown.
        await emit({ type: 'mark', name: 'after-single-s' });
        await key('a', true);
        await advance(15, 100);
        await key('s', false);
        await key('a', false);
      } else if (name === 'bridge') {
        await click(2.5, -1.7);
        await advance(10, 100);
        await click(2.5, -1.95);
        await advance(5, 100);
        await key('s', true);
        await key('d', true); // World +X across the graded deck.
        await advance(4, 400 / 7);
        await emit({ type: 'capture', name: 'bridge-gap' });
        await emit({ type: 'mark', name: 'gap' });
        await advance(3, 400 / 7);
        await emit({ type: 'capture', name: 'bridge-mid' });
        await emit({ type: 'mark', name: 'bridge' });
        await advance(21, 400 / 7);
        await emit({ type: 'mark', name: 'bridge-end' });
        await key('s', false);
        await key('d', false);
      } else if (name === 'stairs') {
        for (const [x, z, count] of [
          [2.5, -1.7, 10], [3.4, -1.93, 8], [4.3, -1.95, 8],
          [5.15, -1.65, 8], [6, -0.9, 8], [7.2, 0.75, 10],
        ]) {
          await click(x, z);
          await advance(count, 100);
        }
        const pad = await page.evaluate(() => {
          const { footPad } = window.__ebr74.stairs;
          return [footPad.position.x, footPad.position.z, footPad.position.y + footPad.geometry.parameters.height / 2];
        });
        // QA's pad route deliberately targets z=0.76 rather than the pad centre.
        await click(pad[0], 0.76, pad[2]);
        await advance(20, 100);
        await emit({ type: 'mark', name: 'pad-arrival' });
        await key('w', true);
        await key('a', true); // World -X, climbing from the pad.
        await advance(6, 100);
        await emit({ type: 'capture', name: 'stairs-mid' });
        await emit({ type: 'mark', name: 'stairs' });
        await advance(46, 100);
        await emit({ type: 'mark', name: 'climb-end' });
        await key('w', false);
        await key('a', false);
        await key('s', true);
        await key('d', true);
        await advance(65, 100);
        await emit({ type: 'mark', name: 'descent-end' });
        await key('s', false);
        await key('d', false);
        const legs = {
          'pad-SA': [[['s', 'a'], 22], [['w', 'a'], 40]],
          'pad-WD': [[['w', 'd'], 22], [['w', 'a'], 60]],
          'pad-both': [[['s', 'd'], 12], [['s', 'a'], 12], [['w', 'd'], 12], [['w', 'a'], 60]],
        };
        for (const [mark, route] of Object.entries(legs)) {
          await key('s', true);
          await key('d', true);
          await advance(50, 100); // Reset to the pad corner, just as QA does.
          await key('s', false);
          await key('d', false);
          for (const [keys, count] of route) {
            for (const code of keys) await key(code, true);
            await advance(count, 100);
            for (const code of keys) await key(code, false);
          }
          await emit({ type: 'mark', name: mark });
        }
        await emit({ type: 'mark', name: 'before-interleaved-descent' });
        await key('s', true);
        await advance(1, 1000 / 60);
        await emit({ type: 'mark', name: 'single-key-descent' });
        await key('d', true);
        await advance(1, 1000 / 60);
        await key('s', false);
        await key('d', false);
      } else if (name === 'stream') {
        await click(1.2, 3.6);
        await advance(15, 100);
        await key('s', true);
        await key('d', true);
        await advance(15, 100);
        await emit({ type: 'capture', name: 'stream-block' });
        await emit({ type: 'mark', name: 'stream' });
        await key('s', false);
        await key('d', false);
      } else throw new Error(`Unknown scenario ${name}`);
    }
    assert.deepEqual(fixture.errors, []);
    return { script, trace, frames, bodylessFrames, bodyShape, marks };
  } finally {
    await fixture.context.close();
  }
}

async function pixelDiff(page, reference, candidate, referenceBodyless, candidateBodyless) {
  return page.evaluate(async ({ reference, candidate, referenceBodyless, candidateBodyless }) => {
    async function decode(data) {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    }
    const images = await Promise.all([reference, candidate, referenceBodyless, candidateBodyless].map(decode));
    const [a, b] = images;
    if (images.some((image) => image.width !== a.width || image.height !== a.height)) throw new Error('Frame dimensions differ');
    const canvas = document.createElement('canvas');
    canvas.width = a.width;
    canvas.height = a.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = images.map((image) => {
      context.clearRect(0, 0, a.width, a.height);
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, a.width, a.height).data;
    });
    const [original, current, withoutOriginal, withoutCurrent] = pixels;
    const diff = context.createImageData(a.width, a.height);
    const mask = context.createImageData(a.width, a.height);
    let changedPixels = 0;
    let outsideBodyPixels = 0;
    let bodylessChangedPixels = 0;
    const differs = (x, y, i) => x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3];
    for (let i = 0; i < original.length; i += 4) {
      const changed = differs(original, current, i);
      const body = differs(original, withoutOriginal, i) || differs(current, withoutCurrent, i);
      if (changed) { changedPixels++; diff.data[i] = 255; diff.data[i + 2] = 255; }
      if (changed && !body) outsideBodyPixels++;
      if (differs(withoutOriginal, withoutCurrent, i)) bodylessChangedPixels++;
      if (body) mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = 255;
      diff.data[i + 3] = 255;
      mask.data[i + 3] = 255;
    }
    context.putImageData(diff, 0, 0);
    const png = canvas.toDataURL('image/png').split(',')[1];
    context.putImageData(mask, 0, 0);
    return { changedPixels, outsideBodyPixels, bodylessChangedPixels, png, mask: canvas.toDataURL('image/png').split(',')[1] };
  }, Object.fromEntries(Object.entries({ reference, candidate, referenceBodyless, candidateBodyless })
    .map(([name, bytes]) => [name, bytes.toString('base64')])));
}

/** Record clean main, then replay the same events and frame times on the candidate. */
export async function compareCharacterParity({ baselineRoot, candidateRoot, evidenceDir, archivedBaselineSha, baselineSha = historicalSha }) {
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  assert.ok([historicalSha, stairBaselineSha].includes(baselineSha), 'Unknown replay reference');
  if (archivedBaselineSha) {
    assert.equal(archivedBaselineSha, baselineSha);
    assert.equal(git(candidateRoot, 'rev-parse', `${baselineSha}^{commit}`), baselineSha);
  } else {
    assert.equal(git(baselineRoot, 'rev-parse', 'HEAD'), baselineSha);
    assert.equal(git(baselineRoot, 'status', '--porcelain', '--untracked-files=no', '--', 'src', 'index.html', 'package.json', 'package-lock.json'), '',
      'The reference worktree must contain the unmodified baseline source');
  }
  let baseline;
  let candidate;
  let browser;
  try {
    baseline = await serverAt(baselineRoot);
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
    const names = ['walking', 'qa-walk', 'key-transitions', 'bridge', 'stairs', 'stream'];
    const reference = {};
    for (const name of names) reference[name] = await recordScenario(browser, baseline.url, name);
    // Keep the generated trace outside every worktree.
    let traceDir;
    try {
      traceDir = await mkdtemp('/tmp/opencode/ebr74-reference-');
    } catch (error) {
      if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
      traceDir = await mkdtemp(join(tmpdir(), 'ebr74-reference-'));
    }
    const tracePath = join(traceDir, 'trace.json');
    await writeFile(tracePath, `${JSON.stringify({ baselineSha, browser: browser.version(), viewport, seed,
      scenarios: Object.fromEntries(names.map((name) => [name, {
        script: reference[name].script, trace: reference[name].trace, marks: reference[name].marks,
      }])) }, null, 2)}\n`);
    const saved = JSON.parse(await readFile(tracePath, 'utf8'));
    await baseline.server.close();
    baseline = undefined;
    candidate = await serverAt(candidateRoot);
    const results = {};
    const frameResults = {};
    const bodyIsolation = {};
    const traceMismatches = [];
    const traces = {};
    const diffPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    for (const name of names) {
      const current = await recordScenario(browser, candidate.url, name, saved.scenarios[name].script);
      // Canonicalize -0 as JSON does in the recorded reference, but otherwise
      // compare every position, rotation, camera and shadow value exactly.
      const actualTrace = JSON.parse(JSON.stringify(current.trace));
      const expectedTrace = saved.scenarios[name].trace;
      traces[name] = { baseline: expectedTrace, candidate: actualTrace };
      const mismatch = actualTrace.findIndex((frame, index) => !isDeepStrictEqual(frame, expectedTrace[index]));
      const identical = mismatch === -1 && actualTrace.length === expectedTrace.length;
      if (!identical) traceMismatches.push({ scenario: name, frame: mismatch,
        baseline: expectedTrace[mismatch], candidate: actualTrace[mismatch],
        baselineFrames: expectedTrace.length, candidateFrames: actualTrace.length });
      if (!isDeepStrictEqual(current.marks, saved.scenarios[name].marks)) {
        traceMismatches.push({ scenario: name, marks: 'scenario state differs' });
      }
      if (!isDeepStrictEqual(current.bodyShape, reference[name].bodyShape)) {
        traceMismatches.push({ scenario: name, body: 'geometry, material or shade shader differs' });
      }
      results[name] = { frames: current.trace.length, identical };
      for (const [frameName, bytes] of Object.entries(current.frames)) {
        const original = reference[name].frames[frameName];
        assert.ok(original, `Missing baseline frame ${frameName}`);
        const diff = await pixelDiff(diffPage, original, bytes, reference[name].bodylessFrames[frameName], current.bodylessFrames[frameName]);
        frameResults[frameName] = diff.changedPixels;
        bodyIsolation[frameName] = { outsideBodyPixels: diff.outsideBodyPixels, bodylessChangedPixels: diff.bodylessChangedPixels };
        if (evidenceDir) {
          for (const directory of ['baseline', 'candidate', 'diff', 'mask']) await mkdir(join(evidenceDir, directory), { recursive: true });
          await writeFile(join(evidenceDir, 'baseline', `${frameName}.png`), original);
          await writeFile(join(evidenceDir, 'candidate', `${frameName}.png`), bytes);
          await writeFile(join(evidenceDir, 'diff', `${frameName}.png`), Buffer.from(diff.png, 'base64'));
          await writeFile(join(evidenceDir, 'mask', `${frameName}.png`), Buffer.from(diff.mask, 'base64'));
        }
      }
    }
    await diffPage.close();
    const marks = Object.fromEntries(names.map((name) => [name, saved.scenarios[name].marks]));
    assert.ok(Math.abs(marks.bridge.gap.position[0] - 3.3) < 0.01, 'character must cross a visible deck gap');
    assert.ok(Math.abs(marks.bridge.bridge.position[0] - 3.9) < 0.01 &&
      Math.abs(marks.bridge.bridge.position[1] - 2.52) < 1e-8, 'character must reach the raised bridge midpoint');
    assert.equal(marks.bridge.bridge.deck.blocksWalking, false);
    assert.ok(marks.bridge.bridge.waterCount > 10);
    assert.equal(marks.bridge.bridge.boxesInDeck, 0, 'water boxes must leave the deck gap open');
    assert.ok(marks.bridge.bridge.gapWidths.every((width) => Math.abs(width - 0.04) < 1e-5));
    assert.ok(marks.stairs.stairs.position[0] > 9 && marks.stairs.stairs.position[0] < 11.5 &&
      marks.stairs.stairs.position[1] > 0.16 && marks.stairs.stairs.position[1] < 2.4, 'character must be mid-climb');
    assert.ok(marks.stream.stream.position[0] > 1.2 && marks.stream.stream.position[0] < 2,
      'stream must block the off-bridge route');
    // Independent QA checkpoints from main-9e8c8c6/sequences.json. These
    // manual 100 ms frames can stop one collision substep away from real-time
    // QA, so their X/Z tolerance is explicit; the replay itself is exact.
    const checkpoint = (actual, expected, horizontal = 0.08, vertical = 0.002) => {
      actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= (index === 1 ? vertical : horizontal),
        `QA checkpoint: ${actual} differs from ${expected}`));
    };
    checkpoint(marks.walking.spawn.position, [0, 2.4, 0], 1e-8, 1e-8);
    checkpoint(marks['qa-walk'].walkD2s.position, [2.186, 2.4, -2.149]);
    checkpoint(marks.bridge['bridge-end'].position, [7.6, 2.4, -1.915]);
    checkpoint(marks.stairs['pad-arrival'].position, [12.8, 0.345, 0.76]);
    checkpoint(marks.stairs['climb-end'].position, [4.207, 2.4, 0.76]);
    checkpoint(marks.stairs['descent-end'].position, [13.15, 0.16, 0.76]);
    checkpoint(marks.stairs['pad-SA'].position, [5.11, 2.4, 0.95]);
    checkpoint(marks.stairs['pad-WD'].position, [4.257, 2.4, 0.55]);
    checkpoint(marks.stairs['pad-both'].position, [4.257, 2.4, 0.55]);
    const before = marks['key-transitions']['before-single-s'].position;
    const after = marks['key-transitions']['after-single-s'].position;
    const singleKeyStep = 3.5 / 60 / Math.sqrt(2);
    assert.ok(Math.abs(after[0] - before[0] - singleKeyStep) < 1e-6 &&
      Math.abs(after[2] - before[2] - singleKeyStep) < 1e-6, 'the interleaved single-key frame must actually move');
    const report = { baselineSha, candidateSha: git(candidateRoot, 'rev-parse', 'HEAD'),
      sourceStatus: git(candidateRoot, 'status', '--porcelain', '--untracked-files=all', '--',
        'src', 'index.html', 'package.json', 'package-lock.json', 'tools/character-parity.mjs', 'tests/browser/character-replay.browser.mjs'),
      browser: browser.version(), renderer: 'SwiftShader', search, viewport, deviceScaleFactor: 1, seed,
      tracePath: evidenceDir ? join(evidenceDir, 'traces.json') : tracePath, results, traceMismatches, frameResults, bodyIsolation, marks };
    if (evidenceDir) {
      await writeFile(join(evidenceDir, 'traces.json'), `${JSON.stringify(traces, null, 2)}\n`);
      await writeFile(join(evidenceDir, 'parity.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
    assert.deepEqual(traceMismatches, [], 'Character position / pose replay differs from main');
    assert.ok(Object.values(bodyIsolation).every(({ outsideBodyPixels, bodylessChangedPixels }) =>
      outsideBodyPixels === 0 && bodylessChangedPixels === 0), 'Route frames contain changes beyond the character body');
    return report;
  } finally {
    await browser?.close();
    await baseline?.server.close();
    await candidate?.server.close();
  }
}
