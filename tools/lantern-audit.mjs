import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Test-only close framing near the existing sign: compare real rendered pixels
// with the carried point light on/off, without adding any test light or prop.
const url = process.env.LIGHTING_URL || 'http://100.88.150.21:5184';
const dir = process.env.LIGHTING_EVIDENCE_DIR || 'evidence/lighting';
const label = process.env.LIGHTING_CAPTURE_LABEL || 'lantern';
const tune = JSON.parse(process.env.LIGHTING_TUNE || '{}');
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
try {
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__lanternAudit = { scene, camera, character, controls, follow, renderer, composer };\n` });
  });
  await page.goto(`${url}/?phase=night&weather=clear&pixel=0`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__lanternAudit));
  const result = await page.evaluate((values) => {
    const { scene, camera, character, controls, follow, renderer, composer } = window.__lanternAudit;
    renderer.setAnimationLoop(null);
    character.position.set(0.2, 2.4, -1.5);
    controls.update(0);
    follow(character.position);
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const light = character.getObjectByName('lantern-light');
    if (values.position) scene.getObjectByName('day-night-directional').position.set(...values.position);
    if (values.directional !== undefined) scene.getObjectByName('day-night-directional').intensity = values.directional;
    if (values.ambient !== undefined) scene.getObjectByName('day-night-ambient').intensity = values.ambient;
    if (values.hemisphere !== undefined) scene.getObjectByName('day-night-hemisphere').intensity = values.hemisphere;
    if (values.lantern !== undefined) light.intensity = values.lantern;
    if (values.lanternDistance !== undefined) light.distance = values.lanternDistance;
    const intensity = light.intensity;
    const canvas = document.createElement('canvas');
    canvas.width = renderer.domElement.width;
    canvas.height = renderer.domElement.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const capture = () => {
      composer.render(0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(renderer.domElement, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const on = capture();
    light.intensity = 0;
    const off = capture();
    light.intensity = intensity;
    composer.render(0);
    const luminance = (data, i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    const sample = ([x, y, z]) => {
      const p = character.position.clone().set(x, y, z).project(camera);
      const sx = Math.round((p.x + 1) * canvas.width / 2);
      const sy = Math.round((1 - p.y) * canvas.height / 2);
      const offset = (sy * canvas.width + sx) * 4;
      return { world: [x, y, z], screen: [sx, sy], on: [...on.slice(offset, offset + 3)],
        off: [...off.slice(offset, offset + 3)], luminanceLift: luminance(on, offset) - luminance(off, offset) };
    };
    return { intensity, distance: light.distance, position: light.getWorldPosition(character.position.clone()).toArray(),
      ground: [[0.92, 2.43, -1], [1.2, 2.43, -0.8], [1.4, 2.43, -1.4]].map(sample),
      sign: [[0.7, 3.4, -2.29], [1.2, 3.4, -2.29]].map(sample) };
  }, tune);
  await page.screenshot({ path: join(dir, `${label}.png`) });
  await page.evaluate(() => {
    const { character, composer } = window.__lanternAudit;
    character.getObjectByName('lantern-light').intensity = 0;
    composer.render(0);
  });
  await page.screenshot({ path: join(dir, `${label}-off.png`) });
  await writeFile(join(dir, `${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  if (!result.ground.some((sample) => sample.luminanceLift > 1) || !result.sign.some((sample) => sample.luminanceLift > 1)) {
    throw new Error('Lantern did not measurably light nearby ground and sign');
  }
} finally {
  await page.close();
  await browser.close();
}
