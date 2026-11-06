import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Keep the real scene and weather lighting. Hide only rain particles during
// the paired wool-pixel measurement so blue streaks are not mistaken for wool.
const output = join(dirname(fileURLToPath(import.meta.url)), 'night-weather');
const url = (process.env.EBR70_URL || 'http://100.88.150.21:5213').replace(/\/$/, '');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
const proof = { chromium: browser.version(), viewport: [1280, 720], buffer: [320, 180], visualSeed: 123, rainSeed: 0xeb730001, cases: {} };
try {
  for (const mode of ['clear', 'cloudy', 'rain']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.addInitScript(() => {
        let state = 0xeb730001;
        window.__nightRainRandom = () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          return state / 0x100000000;
        };
        let id = 0;
        const callbacks = new Map();
        window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
        window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
        window.__nightStep = (time) => {
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
        await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__nightRainRandom,')}
window.__nightProof = { scene, renderer, composer, weather };
` });
      });
      await page.goto(`${url}/?phase=night&weather=${mode}&seed=123`, { waitUntil: 'networkidle' });
      assert.ok(await page.evaluate(() => Boolean(window.__nightProof)));
      await page.evaluate(() => {
        window.__nightStep(0);
        window.__nightProof.weather.update(1.75);
        window.__nightProof.composer.render(0);
      });
      const cdp = await context.newCDPSession(page);
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      const png = Buffer.from(screenshot.data, 'base64');
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1280, 720]);
      await writeFile(join(output, `night-${mode}-full.png`), png);
      await cdp.detach();

      const measurement = await page.evaluate(() => {
        const { scene, renderer, composer, weather } = window.__nightProof;
        const rain = scene.getObjectByName('weather-rain');
        const rainWasVisible = rain.visible;
        rain.visible = false;
        const canvas = document.createElement('canvas');
        canvas.width = renderer.domElement.width;
        canvas.height = renderer.domElement.height;
        if (canvas.width !== 320 || canvas.height !== 180) throw new Error('Expected the 320×180 pixel pass');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        function read() {
          composer.render(0);
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(renderer.domElement, 0, 0);
          return context.getImageData(0, 0, canvas.width, canvas.height).data;
        }
        const normal = read();
        const sheep = [1, 2].map((index) => {
          const animal = scene.getObjectByName(`sheep-${index}`);
          const wool = animal.children.filter((object) => object.name.includes('-wool-'));
          wool.forEach((object) => { object.visible = false; });
          const hidden = read();
          wool.forEach((object) => { object.visible = true; });
          const channels = [[], [], []];
          let pixels = 0; let coolPixels = 0; let blownPixels = 0;
          for (let i = 0; i < normal.length; i += 4) {
            const difference = Math.max(Math.abs(normal[i] - hidden[i]), Math.abs(normal[i + 1] - hidden[i + 1]),
              Math.abs(normal[i + 2] - hidden[i + 2]));
            if (difference < 3) continue;
            pixels++;
            if (normal[i + 2] > normal[i] + 2) coolPixels++;
            if (Math.min(normal[i], normal[i + 1], normal[i + 2]) >= 250) blownPixels++;
            for (let channel = 0; channel < 3; channel++) channels[channel].push(normal[i + channel]);
          }
          const median = channels.map((values) => values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : null);
          return { index, pixels, coolPixels, blownPixels, median };
        });
        rain.visible = rainWasVisible;
        composer.render(0);
        return { weather: weather.getWeather(), rainWasVisible, rainMaskedForMeasurement: true, sheep };
      });
      assert.equal(measurement.weather.mode, mode);
      if (mode === 'cloudy') assert.equal(measurement.weather.cloudyAmount, 1);
      if (mode === 'rain') assert.equal(measurement.weather.rainAmount, 1);
      for (const animal of measurement.sheep) {
        assert.ok(animal.pixels >= 10, `${mode} sheep ${animal.index}: too few wool pixels`);
        assert.equal(animal.blownPixels, 0, `${mode} sheep ${animal.index}: clipped wool`);
        assert.ok(animal.median[0] >= animal.median[1] + 2 && animal.median[0] >= animal.median[2] + 6,
          `${mode} sheep ${animal.index}: wool is not warm: ${animal.median}`);
        assert.ok(animal.coolPixels <= Math.max(1, Math.floor(animal.pixels * 0.1)),
          `${mode} sheep ${animal.index}: blue-dominant pixels ${animal.coolPixels}/${animal.pixels}`);
      }
      assert.deepEqual(errors, []);
      proof.cases[mode] = { ...measurement, errors };
      console.log(mode, JSON.stringify(measurement));
    } finally {
      await context.close();
    }
  }
  await writeFile(join(output, 'measurements.json'), `${JSON.stringify(proof, null, 2)}\n`);
} finally {
  await browser.close();
}
