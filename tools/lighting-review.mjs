import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Fixed-URL, pixel-pass review frames. Test-only facing/zoom changes do not
// ship in the game; the full frames retain the normal camera and spawn pose.
const url = process.env.LIGHTING_URL || 'http://100.88.150.21:5184';
const dir = process.env.LIGHTING_EVIDENCE_DIR || 'evidence/lighting';
const label = process.env.LIGHTING_REVIEW_LABEL || 'review';
const only = process.env.LIGHTING_REVIEW_ONLY;
await mkdir(dir, { recursive: true });
const cases = [
  ['morning', 'clear'], ['daytime', 'clear'], ['sunset', 'clear'], ['night', 'clear'],
  ['night', 'rain'], ['daytime', 'cloudy'], ['daytime', 'rain'],
];
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const proof = { label, browser: browser.version(), viewport: [1280, 720], seed: 0x1a2b3c4d, cases: {} };
try {
  for (const [phase, mode] of cases) {
    if (only && only !== `${phase}-${mode}`) continue;
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
    });
    await page.addInitScript(() => {
      let state = 0x1a2b3c4d;
      Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
      // Stop elapsed-time and rain randomness before the first app frame.
      let id = 0;
      const callbacks = new Map();
      window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
      window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    });
    await page.route('**/src/main.ts*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nwindow.__lightingReview = { scene, camera, character, follow, renderer, composer, weather, dayNight };\n` });
    });
    await page.goto(`${url}/?phase=${phase}&weather=${mode}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => Boolean(window.__lightingReview && window.getPixelRendering?.().canvasWidth), null, { polling: 100 });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      const { renderer, weather, composer, dayNight } = window.__lightingReview;
      renderer.setAnimationLoop(null);
      weather.update(1.75);
      dayNight.updateCharacterShadow?.();
      composer.render(0);
    });
    const key = `${phase}-${mode}`;
    const cdp = await context.newCDPSession(page);
    const capture = async (name) => {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(join(dir, name), Buffer.from(screenshot.data, 'base64'));
    };
    await capture(`review-${label}-${key}-full.png`);
    proof.cases[key] = await page.evaluate(() => {
      const { scene, camera, character } = window.__lightingReview;
      const light = scene.getObjectByName('day-night-directional');
      const shadow = character.getObjectByName('character-shadow');
      scene.updateMatrixWorld(true);
      const foot = character.getWorldPosition(character.position.clone());
      return { light: light.position.toArray(), intensity: light.intensity, color: light.color.getHexString(),
        character: foot.toArray(), shadow: shadow.getWorldPosition(character.position.clone()).sub(foot).toArray(),
        camera: camera.position.toArray(), pixel: window.getPixelRendering(), weather: window.getWeather() };
    });
    if (mode === 'clear' && ['daytime', 'sunset', 'night'].includes(phase)) {
      for (const [facing, angle] of [['toward', Math.PI / 4], ['away', -3 * Math.PI / 4]]) {
        await page.evaluate((angle) => {
          const { character, camera, composer, dayNight } = window.__lightingReview;
          character.rotation.y = angle;
          dayNight.updateCharacterShadow?.();
          camera.zoom = 3;
          camera.updateProjectionMatrix();
          composer.render(0);
        }, angle);
        await capture(`review-${label}-${key}-${facing}.png`);
      }
    }
    await cdp.detach();
    proof.cases[key].errors = errors;
    if (errors.length) throw new Error(`${key}: ${errors.join('; ')}`);
    await page.close();
  }
  await writeFile(join(dir, `review-${label}.json`), `${JSON.stringify(proof, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
}
