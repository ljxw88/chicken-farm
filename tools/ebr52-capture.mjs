import assert from 'node:assert/strict';
import { createServer } from 'vite';

export const viewport = { width: 1280, height: 720 };
export const scenarios = [
  { name: 'morning', phase: 'morning', weather: 'clear' },
  { name: 'day', phase: 'daytime', weather: 'clear' },
  { name: 'sunset', phase: 'sunset', weather: 'clear' },
  { name: 'night', phase: 'night', weather: 'clear' },
  { name: 'cloudy', phase: 'daytime', weather: 'cloudy' },
  { name: 'rain', phase: 'daytime', weather: 'rain' },
  { name: 'snow', phase: 'daytime', weather: 'snow' },
  { name: 'open-hud', phase: 'daytime', weather: 'clear', openHud: true },
];
export const browserArgs = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'];

// Never displace another server. A strict port is tried once before moving on.
export async function serve(root = process.cwd()) {
  for (let port = 5211; port <= 5229; port++) {
    const server = await createServer({ root, configFile: false, logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
    try {
      await server.listen();
      return { server, url: `http://127.0.0.1:${port}`, port };
    } catch (error) {
      await server.close().catch(() => {});
      if (error.code !== 'EADDRINUSE' && error.message !== `Port ${port} is already in use`) throw error;
    }
  }
  throw new Error('No free port in 5211–5229');
}

export async function openFrame(browser, url, scenario, season) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') errors.push(`${message.type()}: ${message.text()}`);
  });
  try {
    await page.addInitScript(() => {
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
      window.__ebr52Step = (time) => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        if (!pending.length) throw new Error('No animation frame was scheduled');
        for (const callback of pending) callback(time);
      };
    });
    // Test-only access to the actual constructed scene; production exposes no new API.
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      const source = await response.text();
      assert.match(source, /\bconst context\s*=/);
      await route.fulfill({ response, body: `${source}\nwindow.__ebr52Scene = context;\n` });
    });
    const params = new URLSearchParams({ phase: scenario.phase, weather: scenario.weather, seed: '123' });
    if (season !== undefined) params.set('season', season);
    await page.goto(`${url}/?${params}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { for (let i = 0; i <= 25; i++) window.__ebr52Step(i * 100); });
    if (scenario.openHud) {
      await page.evaluate(() => document.querySelector('[data-action="sky"]').click());
      assert.equal(await page.locator('#sky-panel').isVisible(), true);
    }
    if (scenario.plot) {
      await page.keyboard.press('p');
      const point = await page.evaluate(() => {
        const { camera, character } = window.__ebr52Scene;
        const p = character.position.clone().set(5.25, 2.4, 5.25).project(camera);
        return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
      });
      await page.mouse.move(point.x, point.y);
      assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
      await page.mouse.click(point.x, point.y);
      await page.evaluate(() => window.__ebr52Step(2600));
      assert.equal(await page.evaluate(() => window.__ebr52Scene.scene.getObjectsByProperty('name', 'garden-plot-seedling').length), 16);
    }
    return { context, page, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function screenshot(frame) {
  const cdp = await frame.context.newCDPSession(frame.page);
  try {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const bytes = Buffer.from(result.data, 'base64');
    assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [viewport.width, viewport.height]);
    return bytes;
  } finally { await cdp.detach(); }
}

export async function inspectFrame(page) {
  return page.evaluate(() => {
    const { scene, camera, character } = window.__ebr52Scene;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const crowns = new Set();
    const rects = [];
    const point = character.position.clone();
    for (let index = 1; index <= 4; index++) {
      const tree = scene.getObjectByName(`farm-tree-${index}`);
      if (!tree) throw new Error(`Tree ${index} missing`);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const parts = tree.children.filter((child) => child.isMesh && !child.name);
      if (parts.length !== 4) throw new Error(`Tree ${index} has ${parts.length} crown parts`);
      for (const part of parts) {
        crowns.add(part);
        const position = part.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld).project(camera);
          const x = (point.x + 1) * innerWidth / 2, y = (1 - point.y) * innerHeight / 2;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
      // Vertex-projected bounds, padded one 4px world pixel and aligned to the pass.
      const x = Math.max(0, Math.floor((minX - 4) / 4) * 4);
      const y = Math.max(0, Math.floor((minY - 4) / 4) * 4);
      const right = Math.min(innerWidth, Math.ceil((maxX + 4) / 4) * 4);
      const bottom = Math.min(innerHeight, Math.ceil((maxY + 4) / 4) * 4);
      rects.push({ name: tree.name, x, y, width: right - x, height: bottom - y });
    }
    const biome = document.querySelector('.farm-biome__time');
    const autumn = biome.querySelector('[data-season]');
    let label;
    if (autumn) label = autumn.getBoundingClientRect();
    else {
      const text = [...biome.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes('Spring'));
      if (!text) throw new Error('Spring label missing');
      const start = text.textContent.indexOf('Spring');
      const range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + 'Spring'.length);
      label = range.getBoundingClientRect();
    }
    const labelRect = { x: label.x, y: label.y, width: label.width, height: label.height };
    const nodes = [];
    scene.traverse((object) => {
      const material = object.material && (Array.isArray(object.material) ? object.material : [object.material]);
      nodes.push({
        name: object.name, type: object.type, visible: object.visible,
        position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(),
        crown: crowns.has(object),
        geometry: object.geometry ? { type: object.geometry.type,
          attributes: Object.fromEntries(Object.entries(object.geometry.attributes).map(([name, attribute]) =>
            [name, [attribute.itemSize, attribute.count, attribute.normalized]])), indexCount: object.geometry.index?.count ?? null } : null,
        material: material ? material.map((item) => ({ type: item.type, color: item.color?.getHex() ?? null,
          emissive: item.emissive?.getHex() ?? null, emissiveIntensity: item.emissiveIntensity ?? null,
          opacity: item.opacity, transparent: item.transparent, depthWrite: item.depthWrite,
          roughness: item.roughness ?? null, flatShading: item.flatShading ?? null })) : null,
        light: object.isLight ? { color: object.color.getHex(), intensity: object.intensity } : null,
      });
    });
    return { rects, labelRect, label: autumn ? autumn.textContent : 'Spring', nodes,
      pose: { position: character.position.toArray(), camera: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
        pixel: window.getPixelRendering(), weather: window.getWeather(), phase: window.getDayNightState().phase } };
  });
}

export function assertOnlyCrownMaterials(spring, autumn) {
  assert.equal(spring.label, 'Spring');
  assert.equal(autumn.label, 'Autumn');
  assert.deepEqual(autumn.rects, spring.rects);
  assert.deepEqual(autumn.pose, spring.pose);
  assert.equal(autumn.nodes.length, spring.nodes.length);
  const swaps = new Map([[0x5fa846, 0xcf9a38], [0x7cbc5a, 0xe2b94e], [0x3d7a3a, 0xa8722c]]);
  let count = 0;
  for (let i = 0; i < spring.nodes.length; i++) {
    const a = spring.nodes[i], b = structuredClone(autumn.nodes[i]);
    if (a.crown) {
      count++;
      assert.equal(b.crown, true);
      assert.equal(b.material.length, 1);
      assert.equal(b.material[0].color, swaps.get(a.material[0].color), `crown ${count}`);
      b.material[0].color = a.material[0].color;
    }
    assert.deepEqual(b, a, `scene node ${i}: ${a.name || a.type}`);
  }
  assert.equal(count, 16, 'all four trees must use all four crown clusters');
}

// Render a high-contrast intervention on exactly the crown materials. Its
// black/white difference is an independently measured visible foliage mask;
// foreground occluders, fog, the pixel pass and HTML remain in place.
export async function captureCrownSilhouette(frame) {
  await frame.page.evaluate(() => {
    const { scene, composer } = window.__ebr52Scene;
    const materials = new Set();
    for (let i = 1; i <= 4; i++) {
      const tree = scene.getObjectByName(`farm-tree-${i}`);
      for (const child of tree.children) if (child.isMesh && !child.name) materials.add(child.material);
    }
    window.__ebr52Materials = [...materials].map((material) => ({ material, color: material.color.clone() }));
    for (const { material } of window.__ebr52Materials) material.color.setHex(0x000000);
    composer.render(0);
  });
  const black = await screenshot(frame);
  await frame.page.evaluate(() => {
    for (const { material } of window.__ebr52Materials) material.color.setHex(0xffffff);
    window.__ebr52Scene.composer.render(0);
  });
  const white = await screenshot(frame);
  await frame.page.evaluate(() => {
    for (const { material, color } of window.__ebr52Materials) material.color.copy(color);
    delete window.__ebr52Materials;
    window.__ebr52Scene.composer.render(0);
  });
  return { black, white };
}

export async function compareFrames(page, before, after, { rects = [], labelRects = [], silhouette } = {}) {
  return page.evaluate(async ({ before, after, rects, labelRects, black, white }) => {
    async function decode(data) {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    }
    const images = await Promise.all([before, after, ...(black && white ? [black, white] : [])].map(decode));
    if (images.some((image) => image.width !== 1280 || image.height !== 720)) throw new Error('Frame dimensions differ');
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = images.map((image) => {
      ctx.clearRect(0, 0, 1280, 720); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, 1280, 720).data;
    });
    const [a, b, maskBlack, maskWhite] = pixels;
    const diff = ctx.createImageData(1280, 720), mask = ctx.createImageData(1280, 720);
    const diffPixels = diff.data, maskPixels = mask.data;
    const label = labelRects.length ? {
      x: Math.floor(Math.min(...labelRects.map((r) => r.x))), y: Math.floor(Math.min(...labelRects.map((r) => r.y))),
      right: Math.ceil(Math.max(...labelRects.map((r) => r.x + r.width))),
      bottom: Math.ceil(Math.max(...labelRects.map((r) => r.y + r.height))),
    } : null;
    const contains = (r, x, y) => x >= r.x && y >= r.y && x < (r.right ?? r.x + r.width) && y < (r.bottom ?? r.y + r.height);
    const different = (left, right, i) => left[i] !== right[i] || left[i + 1] !== right[i + 1] ||
      left[i + 2] !== right[i + 2] || left[i + 3] !== right[i + 3];
    const treePixels = Object.fromEntries(rects.map((r) => [r.name, 0]));
    let changed = 0, outsideBounds = 0, outsideSilhouette = 0, labelPixels = 0, crownPixels = 0, over250 = 0, maxChannel = 0;
    let minX = 1280, minY = 720, maxX = -1, maxY = -1;
    for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
      const i = (y * 1280 + x) * 4;
      const visible = Boolean(maskBlack && maskWhite && different(maskBlack, maskWhite, i));
      if (visible) {
        maskPixels[i] = maskPixels[i + 1] = maskPixels[i + 2] = 255;
        crownPixels++;
        const channel = Math.max(b[i], b[i + 1], b[i + 2]);
        maxChannel = Math.max(maxChannel, channel);
        if (channel > 250) over250++;
      }
      maskPixels[i + 3] = 255;
      diffPixels[i + 3] = 255;
      if (!different(a, b, i)) continue;
      changed++;
      const inLabel = label && contains(label, x, y);
      const trees = rects.filter((r) => contains(r, x, y));
      if (inLabel) labelPixels++;
      else for (const tree of trees) treePixels[tree.name]++;
      const allowed = inLabel || trees.length > 0;
      if (!allowed) {
        outsideBounds++;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      if (maskBlack && maskWhite && !inLabel && !visible) outsideSilhouette++;
      diffPixels[i] = allowed ? 0 : 255;
      diffPixels[i + 1] = allowed ? 180 : 0;
      diffPixels[i + 2] = 255;
    }
    ctx.putImageData(diff, 0, 0);
    const diffPng = canvas.toDataURL('image/png').split(',')[1];
    ctx.putImageData(mask, 0, 0);
    const maskPng = canvas.toDataURL('image/png').split(',')[1];
    return { changed, outsideBounds, outsideSilhouette, labelPixels, treePixels, crownPixels, maxChannel, over250,
      outsideBoundsRect: outsideBounds ? { minX, minY, maxX, maxY } : null, label, diffPng, maskPng };
  }, { before: before.toString('base64'), after: after.toString('base64'), rects, labelRects,
    black: silhouette?.black.toString('base64'), white: silhouette?.white.toString('base64') });
}

export async function cropImage(page, image, rect) {
  return Buffer.from(await page.evaluate(async ({ image, rect }) => {
    const source = new Image(); source.src = `data:image/png;base64,${image}`; await source.decode();
    const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
    const right = Math.min(source.width, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(source.height, Math.ceil(rect.y + rect.height));
    const canvas = document.createElement('canvas'); canvas.width = right - x; canvas.height = bottom - y;
    canvas.getContext('2d').drawImage(source, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { image: image.toString('base64'), rect }), 'base64');
}

export async function projectedObjects(page, names, padding = 16) {
  return page.evaluate(({ names, padding }) => {
    const { scene, camera, character } = window.__ebr52Scene;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
    const p = character.position.clone();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const name of names) {
      const object = scene.getObjectByName(name);
      if (!object) throw new Error(`Missing crop object: ${name}`);
      object.traverse((child) => {
        const position = child.geometry?.getAttribute('position');
        if (!position || !child.visible) return;
        for (let i = 0; i < position.count; i++) {
          p.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).project(camera);
          const x = (p.x + 1) * innerWidth / 2, y = (1 - p.y) * innerHeight / 2;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      });
    }
    if (!Number.isFinite(minX)) throw new Error(`No crop geometry: ${names.join(', ')}`);
    const x = Math.max(0, minX - padding), y = Math.max(0, minY - padding);
    const right = Math.min(innerWidth, maxX + padding), bottom = Math.min(innerHeight, maxY + padding);
    return { x, y, width: right - x, height: bottom - y };
  }, { names, padding });
}
