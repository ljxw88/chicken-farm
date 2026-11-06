import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const baselineSha = '9e8c8c6c479567fcb4c7796763e86ceb6d6b72a4';
const viewport = { width: 1280, height: 720 };
const seed = 0xeb740001;

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
  await page.goto(`${url}/?phase=daytime&weather=clear`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => window.__ebr74 && window.__ebr74RandomCalls > 0));
  await page.evaluate(() => document.fonts.ready);
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

async function perform(fixture, action, trace, frames, marks) {
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
  const marks = {};
  let time = 0;
  async function emit(action) {
    script.push(action);
    await perform(fixture, action, trace, frames, marks);
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
      for (const action of replayScript) await perform(fixture, action, trace, frames, marks);
    } else {
      await emit({ type: 'frames', times: [0] });
      if (name === 'walking') {
        await emit({ type: 'capture', name: 'spawn' });
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
        await advance(7, 400 / 7);
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
        await click(...pad);
        await advance(20, 100);
        await key('w', true);
        await key('a', true); // World -X, climbing from the pad.
        await advance(6, 100);
        await emit({ type: 'capture', name: 'stairs-mid' });
        await emit({ type: 'mark', name: 'stairs' });
        await advance(12, 100);
        await key('w', false);
        await key('a', false);
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
    return { script, trace, frames, marks };
  } finally {
    await fixture.context.close();
  }
}

async function pixelDiff(page, reference, candidate) {
  return page.evaluate(async ({ reference, candidate }) => {
    async function decode(data) {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    }
    const [a, b] = await Promise.all([decode(reference), decode(candidate)]);
    if (a.width !== b.width || a.height !== b.height) throw new Error('Frame dimensions differ');
    const canvas = document.createElement('canvas');
    canvas.width = a.width;
    canvas.height = a.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(a, 0, 0);
    const original = context.getImageData(0, 0, a.width, a.height);
    context.clearRect(0, 0, a.width, a.height);
    context.drawImage(b, 0, 0);
    const current = context.getImageData(0, 0, a.width, a.height);
    const diff = context.createImageData(a.width, a.height);
    let changedPixels = 0;
    for (let i = 0; i < original.data.length; i += 4) {
      const changed = original.data[i] !== current.data[i] || original.data[i + 1] !== current.data[i + 1] ||
        original.data[i + 2] !== current.data[i + 2] || original.data[i + 3] !== current.data[i + 3];
      if (changed) { changedPixels++; diff.data[i] = 255; diff.data[i + 2] = 255; }
      diff.data[i + 3] = 255;
    }
    context.putImageData(diff, 0, 0);
    return { changedPixels, png: canvas.toDataURL('image/png').split(',')[1] };
  }, { reference: reference.toString('base64'), candidate: candidate.toString('base64') });
}

/** Record main in a temporary worktree, then replay the same events and frame times on the candidate. */
export async function compareCharacterParity({ baselineRoot, candidateRoot, evidenceDir }) {
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  assert.equal(git(baselineRoot, 'rev-parse', 'HEAD'), baselineSha);
  assert.equal(git(baselineRoot, 'status', '--porcelain', '--untracked-files=no', '--', 'src', 'index.html', 'package.json', 'package-lock.json'), '',
    'The reference worktree must contain the unmodified baseline source');
  const baseline = await serverAt(baselineRoot);
  const candidate = await serverAt(candidateRoot);
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
    const names = ['walking', 'bridge', 'stairs', 'stream'];
    const reference = {};
    for (const name of names) reference[name] = await recordScenario(browser, baseline.url, name);
    // The reference is generated from the clean main worktree and stays there, never in the branch.
    const tracePath = join(baselineRoot, '.ebr74-reference-trace.json');
    await writeFile(tracePath, `${JSON.stringify({ baselineSha, browser: browser.version(), viewport, seed,
      scenarios: Object.fromEntries(names.map((name) => [name, {
        script: reference[name].script, trace: reference[name].trace, marks: reference[name].marks,
      }])) }, null, 2)}\n`);
    const saved = JSON.parse(await readFile(tracePath, 'utf8'));
    const results = {};
    const frameResults = {};
    const diffPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    for (const name of names) {
      const current = await recordScenario(browser, candidate.url, name, saved.scenarios[name].script);
      assert.deepEqual(current.trace, saved.scenarios[name].trace, `${name}: movement, yaw, camera or shadow trace differs`);
      assert.deepEqual(current.marks, saved.scenarios[name].marks, `${name}: scenario state differs`);
      results[name] = { frames: current.trace.length, identical: true };
      for (const [frameName, bytes] of Object.entries(current.frames)) {
        const original = reference[name].frames[frameName];
        assert.ok(original, `Missing baseline frame ${frameName}`);
        const diff = await pixelDiff(diffPage, original, bytes);
        frameResults[frameName] = diff.changedPixels;
        if (evidenceDir) {
          for (const directory of ['baseline', 'candidate', 'diff']) await mkdir(join(evidenceDir, directory), { recursive: true });
          await writeFile(join(evidenceDir, 'baseline', `${frameName}.png`), original);
          await writeFile(join(evidenceDir, 'candidate', `${frameName}.png`), bytes);
          await writeFile(join(evidenceDir, 'diff', `${frameName}.png`), Buffer.from(diff.png, 'base64'));
        }
        assert.equal(diff.changedPixels, 0, `${frameName}: changed pixels`);
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
    const report = { baselineSha, candidateSha: git(candidateRoot, 'rev-parse', 'HEAD'), browser: browser.version(),
      viewport, deviceScaleFactor: 1, seed, tracePath, results, frameResults, marks };
    if (evidenceDir) await writeFile(join(evidenceDir, 'parity.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await browser?.close();
    await baseline.server.close();
    await candidate.server.close();
  }
}
