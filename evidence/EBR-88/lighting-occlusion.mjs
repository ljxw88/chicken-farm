// Compare the lighting probe's character samples with/without rain at the same frame.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const output = dirname(fileURLToPath(import.meta.url));
const server = await createServer({ configFile: false, logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const address = server.httpServer.address();
assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (['warning', 'error'].includes(message.type()) && !message.location().url.endsWith('/favicon.ico')) {
    errors.push(`${message.type()}: ${message.text()}`);
  }
});
try {
  await page.addInitScript(() => {
    let state = 0x1a2b3c4d;
    Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr88Step = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame was scheduled');
      for (const callback of current) callback(time);
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__occlusion = { scene, camera, character, controls, follow, renderer, composer, weather, dayNight };\n` });
  });
  await page.goto(`http://127.0.0.1:${address.port}/?phase=sunset&weather=rain&pixel=0`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__ebr88Step(0);
    const { renderer, weather } = window.__occlusion;
    renderer.setAnimationLoop(null);
    weather.update(1.75);
  });
  // Use the same S then W controls, camera follow, and character pose as the lighting probe.
  for (const key of ['s', 'w']) {
    await page.keyboard.down(key);
    await page.evaluate(() => {
      const { controls, character, follow, dayNight } = window.__occlusion;
      controls.update(0.25);
      follow(character.position);
      dayNight.updateCharacterShadow();
    });
    await page.keyboard.up(key);
  }
  const measured = await page.evaluate(() => {
    const { scene, camera, character, renderer, composer, weather } = window.__occlusion;
    scene.updateMatrixWorld(true); camera.updateMatrixWorld();
    const body = character.children.find((object) => object.geometry?.type === 'CapsuleGeometry');
    const light = scene.getObjectByName('day-night-directional');
    const root = scene.getObjectByName('weather-rain');
    const vector = () => character.position.clone();
    const project = (v) => { const p = v.clone().project(camera); return [(p.x + 1) * 640, (1 - p.y) * 360]; };
    const center = body.getWorldPosition(vector());
    const [cx, cy] = project(center);
    const top = project(center.clone().setY(center.y + 1));
    const bottom = project(center.clone().setY(center.y - 1));
    const right = camera.getWorldDirection(vector()).cross(camera.up).normalize();
    const side = project(center.clone().addScaledVector(right, 0.4));
    const r = Math.abs(side[0] - cx);
    const hh = Math.abs(bottom[1] - top[1]) / 2 * 0.7;
    const sunScreenRight = light.getWorldPosition(vector()).sub(character.getWorldPosition(vector())).normalize().dot(right);
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const x0 = Math.trunc(cx - 0.85 * r), x1 = Math.trunc(cx + 0.85 * r);
    const y0 = Math.trunc(cy - 0.3 * hh), y1 = Math.trunc(cy + 0.3 * hh);
    const sample = (visible, takeImage) => {
      root.visible = visible;
      composer.render(0);
      ctx.drawImage(renderer.domElement, 0, 0);
      const width = x1 - x0;
      const data = ctx.getImageData(x0, y0, width, y1 - y0).data;
      const region = (left, right) => {
        let sum = 0, count = 0;
        for (let x = Math.trunc(left); x < Math.trunc(right); x++) {
          for (let y = y0; y < y1; y++) {
            const i = ((y - y0) * width + x - x0) * 4;
            sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            count++;
          }
        }
        return sum / count;
      };
      const left = region(cx - 0.85 * r, cx - 0.2 * r);
      const rightL = region(cx + 0.2 * r, cx + 0.85 * r);
      return { ratio: sunScreenRight > 0 ? left / rightL : rightL / left,
        png: takeImage ? canvas.toDataURL('image/png').split(',')[1] : undefined };
    };
    const samples = [];
    let example;
    for (let frame = 0; frame < 120; frame++) {
      weather.update(0.05);
      const full = sample(true, false);
      const masked = sample(false, false);
      samples.push({ frame, full: full.ratio, masked: masked.ratio });
      if (!example && full.ratio < 0.75 && masked.ratio >= 0.75) {
        example = { frame, full: sample(true, true), masked: sample(false, true) };
      }
    }
    root.visible = true;
    return { weather: weather.getWeather(), canvas: [canvas.width, canvas.height], seed: 0x1a2b3c4d,
      threshold: 0.75, frames: samples.length, samples, example };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(measured.weather, { mode: 'rain', rainAmount: 1, cloudyAmount: 0 });
  assert.deepEqual(measured.canvas, [1280, 720]);
  assert.ok(measured.samples.every((sample) => sample.masked >= measured.threshold));
  const failing = measured.samples.filter((sample) => sample.full < measured.threshold);
  if (measured.example) {
    await writeFile(join(output, 'sunset-lighting-unmasked.png'), Buffer.from(measured.example.full.png, 'base64'));
    await writeFile(join(output, 'sunset-lighting-masked.png'), Buffer.from(measured.example.masked.png, 'base64'));
    delete measured.example.full.png;
    delete measured.example.masked.png;
  }
  const result = { browser: browser.version(), ...measured, failures: failing.length, errors };
  await writeFile(join(output, 'lighting-occlusion.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ frames: result.frames, failures: result.failures, example: result.example }, null, 2));
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
