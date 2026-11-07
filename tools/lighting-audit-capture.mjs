import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { outputDirectory } from './evidence-path.mjs';

// Additional audit references, kept separate from the quantitative detector.
// Run with the real dev server already listening, for example:
// LIGHTING_URL=http://100.88.150.21:5184 LIGHTING_CAPTURE_LABEL=before node tools/lighting-audit-capture.mjs
const url = process.env.LIGHTING_URL || 'http://127.0.0.1:5184';
const label = process.env.LIGHTING_CAPTURE_LABEL || 'audit';
const dir = outputDirectory('lighting-audit-capture', 'LIGHTING_EVIDENCE_DIR');
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({
  headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const proof = { browser: browser.version(), viewport: [1280, 720], screenshots: [] };
const save = async (page, name, clip) => {
  const file = `${label}-${name}.png`;
  await page.screenshot({ path: join(dir, file), ...(clip ? { clip } : {}) });
  proof.screenshots.push(file);
};
try {
  for (const weather of ['cloudy', 'rain']) {
    const page = await context.newPage();
    await page.goto(`${url}/?phase=daytime&weather=${weather}`, { waitUntil: 'networkidle' });
    await page.waitForFunction((mode) => window.getWeather?.()[`${mode}Amount`] > 0.99, weather, { timeout: 20000 });
    await save(page, weather);
    await page.close();
  }

  const page = await context.newPage();
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__audit = typeof context !== 'undefined' ? context : { scene, camera, character, follow, renderer, composer };\n` });
  });
  await page.goto(`${url}/?phase=daytime&weather=clear`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__audit));
  await page.evaluate(() => { window.__audit.renderer.setAnimationLoop(null); window.__audit.composer.render(0); });
  await save(page, 'roof-tree-crop', { x: 720, y: 185, width: 160, height: 180 });
  await save(page, 'pond-crop', { x: 750, y: 330, width: 170, height: 120 });
  await save(page, 'motion-a');
  const motion = await page.evaluate(() => {
    const { character, camera, follow, composer } = window.__audit;
    const before = character.position.toArray();
    character.position.x += 0.05;
    follow(character.position);
    composer.render(0);
    return { before, after: character.position.toArray(), camera: camera.position.toArray() };
  });
  await save(page, 'motion-b');
  proof.motion = { ...motion, description: 'Two frozen frames 0.05 world units apart, with the ordinary following camera and 4-CSS-pixel pass.' };
  await page.close();
  await writeFile(join(dir, `${label}-audit-capture.json`), `${JSON.stringify(proof, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
}
