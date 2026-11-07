import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// This reference is captured from a clean, detached main worktree, not from
// the implementation under test. The dump deliberately excludes Three UUIDs.
export const REFERENCE_SHA = 'b41492ef04210b73c38c09379f6dfa4e42581d71';
export const REFERENCE_PATH = 'tests/fixtures/scene-b41492e.json.gz';
const viewport = { width: 1280, height: 720 };
const seed = 0xeb760001;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Most scene objects are identical across snapshots. Pool complete entries so
// the checked-in gzip stays small, then reconstruct the exact original JSON
// before comparison. No scene fields, values, array order or bytes are omitted.
export function packSceneReference(json) {
  const data = JSON.parse(json);
  const pools = {};
  for (const key of ['objects', 'materials', 'geometries']) {
    const entries = [];
    const ids = new Map();
    for (const snapshot of Object.values(data.snapshots)) {
      snapshot[key] = snapshot[key].map((item) => {
        const text = JSON.stringify(item);
        if (!ids.has(text)) { ids.set(text, entries.length); entries.push(item); }
        return ids.get(text);
      });
    }
    pools[key] = entries;
  }
  return gzipSync(JSON.stringify({ format: 'scene-pool-v1', pools, data }), { level: 9 });
}

export function unpackSceneReference(bytes) {
  const packed = JSON.parse(gunzipSync(bytes).toString('utf8'));
  assert.equal(packed.format, 'scene-pool-v1', 'Unexpected scene fixture format');
  for (const snapshot of Object.values(packed.data.snapshots)) {
    for (const key of ['objects', 'materials', 'geometries']) {
      const entries = packed.pools[key];
      assert.ok(Array.isArray(entries) && Array.isArray(snapshot[key]), `Invalid scene pool: ${key}`);
      snapshot[key] = snapshot[key].map((id) => {
        assert.ok(Number.isSafeInteger(id) && id >= 0 && id < entries.length, `Invalid ${key} pool index`);
        return entries[id];
      });
    }
  }
  return JSON.stringify(packed.data);
}

async function open(browser, url, search) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(({ seed }) => {
    let random = seed >>> 0;
    window.__ebr76Random = () => {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      return random / 0x100000000;
    };
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr76Step = (time) => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      if (!pending.length) throw new Error('No animation frame was scheduled');
      for (const callback of pending) callback(time);
    };
  }, { seed });
  // The clean baseline initializes weather in main; the candidate registers it
  // in a feature module. Instrument only the served source, not the app API.
  await page.route('**/src/app/environment.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
    await route.fulfill({ response, body: body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr76Random,') });
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    const legacy = (body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length;
    assert.ok(legacy === 1 || (legacy === 0 && /\bconst context\s*=/.test(body)), 'Unknown app entry point');
    const source = legacy ? body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr76Random,') : body;
    const exposed = legacy ? '{ scene, camera, character, renderer, composer }' : 'context';
    await route.fulfill({ response, body: `${source}\nwindow.__ebr76Scene = ${exposed};\n` });
  });
  await page.goto(`${url}/${search}`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => Boolean(window.__ebr76Scene)), 'Expected the Vite source module');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__ebr76Step(0));
  return { context, page, errors };
}

// The raw typed-array bytes are returned to Node and SHA-256 hashed there. This
// checks procedural geometry, vertex colours and instance matrices as well as
// primitive dimensions; it is stronger than bounding boxes alone.
async function sceneDump(page) {
  const dump = await page.evaluate(() => {
    const { scene, camera, renderer } = window.__ebr76Scene;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const materials = [];
    const geometries = [];
    const materialIds = new Map();
    const geometryIds = new Map();
    const color = (value) => value?.isColor ? value.toArray() : null;
    const bytes = (array) => {
      const data = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      let binary = '';
      for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
      return btoa(binary);
    };
    const attribute = (value) => ({
      itemSize: value.itemSize, count: value.count, normalized: value.normalized,
      arrayType: value.array.constructor.name, bytes: bytes(value.array),
    });
    function materialId(value) {
      if (materialIds.has(value)) return materialIds.get(value);
      const id = materials.length;
      materialIds.set(value, id);
      materials.push({
        type: value.type, color: color(value.color), emissive: color(value.emissive),
        specular: color(value.specular), opacity: value.opacity, transparent: value.transparent,
        visible: value.visible, depthWrite: value.depthWrite, depthTest: value.depthTest,
        side: value.side, blending: value.blending, alphaTest: value.alphaTest,
        vertexColors: value.vertexColors, toneMapped: value.toneMapped,
        roughness: value.roughness ?? null, metalness: value.metalness ?? null,
        emissiveIntensity: value.emissiveIntensity ?? null, flatShading: value.flatShading ?? null,
        polygonOffset: value.polygonOffset, polygonOffsetFactor: value.polygonOffsetFactor,
        polygonOffsetUnits: value.polygonOffsetUnits,
        uniforms: value.uniforms ? Object.fromEntries(Object.entries(value.uniforms)
          .map(([name, uniform]) => [name, color(uniform.value) ?? uniform.value])) : null,
      });
      return id;
    }
    function geometryId(value) {
      if (geometryIds.has(value)) return geometryIds.get(value);
      const id = geometries.length;
      geometryIds.set(value, id);
      const position = value.getAttribute('position');
      let bounds = null;
      if (position?.count) {
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < position.count; i++) {
          const p = [position.getX(i), position.getY(i), position.getZ(i)];
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], p[axis]);
            max[axis] = Math.max(max[axis], p[axis]);
          }
        }
        bounds = { min, max, size: max.map((n, axis) => n - min[axis]) };
      }
      geometries.push({
        type: value.type, bounds,
        groups: value.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex })),
        index: value.index ? attribute(value.index) : null,
        attributes: Object.fromEntries(Object.entries(value.attributes).sort(([a], [b]) => a.localeCompare(b))
          .map(([name, item]) => [name, attribute(item)])),
      });
      return id;
    }
    const objects = [];
    scene.traverse((object) => {
      const entry = {
        type: object.type, name: object.name, visible: object.visible,
        position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
        matrixWorld: object.matrixWorld.toArray(), renderOrder: object.renderOrder,
        castShadow: object.castShadow, receiveShadow: object.receiveShadow,
      };
      if (object.geometry) entry.geometry = geometryId(object.geometry);
      if (object.material) entry.materials = (Array.isArray(object.material) ? object.material : [object.material]).map(materialId);
      if (object.isInstancedMesh) entry.instances = { count: object.count, matrix: attribute(object.instanceMatrix),
        color: object.instanceColor ? attribute(object.instanceColor) : null };
      if (object.isLight) entry.light = {
        color: color(object.color), groundColor: color(object.groundColor), intensity: object.intensity,
        distance: object.distance ?? null, decay: object.decay ?? null,
        target: object.target ? object.target.position.toArray() : null,
      };
      objects.push(entry);
    });
    const fold = scene.getObjectByName('farm-sheepfold');
    const sheep = ['sheep-1', 'sheep-2'].map((name) => scene.getObjectByName(name));
    const shelter = scene.getObjectByName('sheepfold-lean-to');
    const smoke = scene.getObjectByName('chimney-smoke');
    const fireflies = scene.getObjectByName('night-fireflies');
    if (!fold || sheep.some((animal) => !animal) || !shelter || !smoke || !fireflies) {
      throw new Error('The dump must include both sheep, their fold and shelter, smoke and fireflies');
    }
    const canvas = renderer.domElement;
    return {
      background: color(scene.background),
      fog: scene.fog ? { type: scene.fog.isFogExp2 ? 'FogExp2' : 'Fog', color: color(scene.fog.color),
        density: scene.fog.density ?? null, near: scene.fog.near ?? null, far: scene.fog.far ?? null } : null,
      camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
        zoom: camera.zoom, near: camera.near, far: camera.far, left: camera.left, right: camera.right,
        top: camera.top, bottom: camera.bottom, projectionMatrix: camera.projectionMatrix.toArray() },
      pixel: window.getPixelRendering(),
      canvas: { width: canvas.width, height: canvas.height, styleWidth: canvas.style.width, styleHeight: canvas.style.height,
        transform: canvas.style.transform, imageRendering: canvas.style.imageRendering },
      features: { sheep: sheep.length, foldChildren: fold.children.length,
        smokePuffs: smoke.children.length, fireflies: fireflies.count },
      objects, materials, geometries,
    };
  });
  function hashAttributes(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.bytes === 'string') {
      const bytes = Buffer.from(value.bytes, 'base64');
      value.byteLength = bytes.length;
      value.sha256 = hash(bytes);
      delete value.bytes;
    }
    for (const child of Object.values(value)) hashAttributes(child);
  }
  hashAttributes(dump);
  return dump;
}

async function point(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__ebr76Scene;
    camera.updateMatrixWorld();
    const p = character.position.clone().set(x, 2.4, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }, { x, z });
}

export async function captureSceneData(root) {
  const host = process.env.EBR76_DUMP_HOST || '127.0.0.1';
  const port = Number(process.env.EBR76_DUMP_PORT || 0);
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host, port, strictPort: Boolean(port), hmr: false } });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://${host}:${address.port}`;
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
    const snapshots = {};
    for (const [name, search, time] of [
      ['morning', '?phase=morning&weather=clear&grid=1', 0],
      ['day', '?phase=daytime&weather=clear&grid=1', 0],
      ['sunset', '?phase=sunset&weather=clear&grid=1', 0],
      ['night', '?phase=night&weather=clear&grid=1', 0],
      ['cloudy', '?phase=daytime&weather=cloudy&grid=1', 1750],
      ['rain', '?phase=daytime&weather=rain&grid=1', 1750],
      ['night-effects', '?phase=night&weather=clear&grid=1', 1200],
      ['night-effects-rain', '?phase=night&weather=rain&grid=1', 1750],
      ['night-effects-cloudy', '?phase=night&weather=cloudy&grid=1', 1750],
    ]) {
      const fixture = await open(browser, url, search);
      try {
        if (time) await fixture.page.evaluate((time) => window.__ebr76Step(time), time);
        snapshots[name] = await sceneDump(fixture.page);
        assert.deepEqual(fixture.errors, []);
      } finally { await fixture.context.close(); }
    }
    const fixture = await open(browser, url, '?phase=daytime&weather=clear&grid=1');
    try {
      const { page } = fixture;
      await page.keyboard.press('f');
      let p = await point(page, -0.75, 3.75);
      await page.mouse.move(p.x, p.y);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      snapshots['fence-valid'] = await sceneDump(page);
      await page.keyboard.press('r');
      snapshots['fence-rotated'] = await sceneDump(page);
      p = await point(page, -0.75, 0.75);
      await page.mouse.move(p.x, p.y);
      assert.match(await page.locator('.placement-status').textContent(), /Move away/);
      snapshots['fence-invalid'] = await sceneDump(page);
      p = await point(page, -0.75, 3.75);
      await page.mouse.move(p.x, p.y);
      await page.mouse.click(p.x, p.y);
      assert.equal(await page.evaluate(() => window.__ebr76Scene.scene.getObjectByName('placement-layer').children
        .filter((item) => item.name === 'placed-fence').length), 1);
      snapshots['fence-placed'] = await sceneDump(page);
      await page.keyboard.press('p');
      p = await point(page, 5.25, 5.25);
      await page.mouse.move(p.x, p.y);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      snapshots['plot-valid'] = await sceneDump(page);
      await page.mouse.click(p.x, p.y);
      assert.equal(await page.evaluate(() => window.__ebr76Scene.scene.getObjectByName('placement-layer').children
        .filter((item) => item.name === 'placed-plot').length), 1);
      snapshots['plot-placed'] = await sceneDump(page);
      assert.deepEqual(fixture.errors, []);
    } finally { await fixture.context.close(); }
    return { format: 1, viewport, deviceScaleFactor: 1, seed, snapshots };
  } finally {
    await browser?.close();
    await server.close();
  }
}

function assertSameDump(expected, actual, label) {
  if (actual !== expected) {
    const firstDifference = (a, b, path = '$') => {
      if (Object.is(a, b)) return null;
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return path;
      const keys = Object.keys(a);
      if (JSON.stringify(keys) !== JSON.stringify(Object.keys(b))) return `${path} (keys)`;
      for (const key of keys) {
        const found = firstDifference(a[key], b[key], `${path}.${key}`);
        if (found) return found;
      }
      return null;
    };
    assert.fail(`${label} differs from the reference at ${firstDifference(JSON.parse(expected), JSON.parse(actual)) ?? 'JSON encoding'}`);
  }
}

function assertCleanMain(root) {
  const git = (...parts) => execFileSync('git', ['-C', root, ...parts], { encoding: 'utf8' }).trim();
  assert.equal(git('rev-parse', 'HEAD'), REFERENCE_SHA, 'Reference must be the ticket baseline');
  assert.equal(git('status', '--porcelain', '--untracked-files=no', '--', 'src', 'index.html', 'package.json', 'package-lock.json'), '',
    'Reference source must be clean');
}

export async function compareSceneData(root = process.cwd()) {
  const expected = unpackSceneReference(await readFile(resolve(root, REFERENCE_PATH)));
  const actual = JSON.stringify(await captureSceneData(root));
  assertSameDump(expected, actual, 'Candidate scene');
  return { bytes: Buffer.byteLength(expected), sha256: hash(Buffer.from(expected)), snapshots: Object.keys(JSON.parse(expected).snapshots) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('tools/scene-data-dump.mjs')) {
  const args = process.argv.slice(2);
  if (args[0] === '--write-reference' && args[1]) {
    const root = resolve(args[1]);
    assertCleanMain(root);
    const json = JSON.stringify(await captureSceneData(root));
    const packed = packSceneReference(json);
    assert.equal(unpackSceneReference(packed), json, 'Packed fixture must reconstruct the exact reference bytes');
    await writeFile(REFERENCE_PATH, packed, { flag: 'wx' });
    console.log(`Reference ${REFERENCE_SHA}: ${Buffer.byteLength(json)} bytes, ${packed.length} compressed, SHA-256 ${hash(Buffer.from(json))}`);
  } else if (args[0] === '--against-main' && args[1]) {
    const root = resolve(args[1]);
    assertCleanMain(root);
    const expected = unpackSceneReference(await readFile(REFERENCE_PATH));
    assertSameDump(expected, JSON.stringify(await captureSceneData(root)), 'Clean main recapture');
    const result = await compareSceneData();
    console.log(`Clean main recapture and candidate both match ${REFERENCE_SHA}: ${result.snapshots.length} snapshots, ${result.bytes} bytes, SHA-256 ${result.sha256}`);
  } else if (!args.length) {
    const result = await compareSceneData();
    console.log(`Scene dump matches ${REFERENCE_SHA}: ${result.snapshots.length} snapshots, ${result.bytes} bytes, SHA-256 ${result.sha256}`);
  } else {
    throw new Error('Usage: node tools/scene-data-dump.mjs [--write-reference|--against-main <clean-main-worktree>]');
  }
}
