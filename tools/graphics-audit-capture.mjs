import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { outputDirectory } from './evidence-path.mjs';

// Controlled, repeatable close views and geometry/pixel measurements for the
// separate path-winding and static-contact-shadow fixes. Nothing ships in app.
const mode = process.argv[2];
if (!['path', 'shadows', 'windows'].includes(mode)) throw new Error('Choose path, shadows or windows');
const url = process.env.LIGHTING_URL || 'http://127.0.0.1:5184';
const label = process.env.LIGHTING_CAPTURE_LABEL || mode;
const dir = outputDirectory('graphics-audit-capture', 'LIGHTING_EVIDENCE_DIR');
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
try {
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__graphicsAudit = { scene, camera, character, follow, renderer, composer };\n` });
  });
  const phase = mode === 'path' ? 'daytime' : 'night';
  await page.goto(`${url}/?phase=${phase}&weather=clear`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__graphicsAudit));
  await page.evaluate(() => window.__graphicsAudit.renderer.setAnimationLoop(null));
  const proof = { mode, phase, browser: browser.version(), viewport: [1280, 720] };
  if (mode === 'path') {
    proof.path = await page.evaluate(() => {
      const { scene, camera, character, follow, composer } = window.__graphicsAudit;
      character.visible = false; // Reveal the bend underneath the spawn point.
      follow(character.position);
      camera.zoom = 3;
      camera.updateProjectionMatrix();
      composer.render(0);
      return ['farm-path-edge', 'farm-path-surface'].map((name) => {
        const geometry = scene.getObjectByName(name).geometry;
        const p = geometry.getAttribute('position');
        const index = geometry.getIndex();
        let upward = 0;
        let downward = 0;
        let degenerate = 0;
        for (let i = 0; i < index.count; i += 3) {
          const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
          const nx = (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) -
            (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
          if (nx > 1e-10) upward++;
          else if (nx < -1e-10) downward++;
          else degenerate++;
        }
        return { name, upward, downward, degenerate };
      });
    });
    await page.screenshot({ path: join(dir, `${label}.png`) });
  } else if (mode === 'shadows') {
    for (const name of ['tree', 'chicken']) {
      proof[name] = await page.evaluate((name) => {
        const { scene, camera, character, follow, renderer, composer } = window.__graphicsAudit;
        const object = scene.getObjectByName(name === 'tree' ? 'farm-tree-1' : 'farm-chicken');
        const parent = name === 'tree' ? object : scene.getObjectByName('farm-flock-decorations');
        const shadow = parent.children.find((child) => child.isMesh && child.geometry.type === 'CircleGeometry');
        follow(object.position);
        camera.zoom = 3;
        camera.updateProjectionMatrix();
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
        const on = pixels(true);
        const off = pixels(false);
        let brightenedPixels = 0;
        let darkenedPixels = 0;
        let totalChange = 0;
        for (let i = 0; i < on.length; i += 4) {
          const luma = (data) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          const change = luma(on) - luma(off);
          if (change > 1) brightenedPixels++;
          if (change < -1) darkenedPixels++;
          totalChange += change;
        }
        shadow.visible = true;
        composer.render(0);
        return { brightenedPixels, darkenedPixels, totalLuminanceChange: totalChange,
          shadowColor: shadow.material.color.getHex(), focus: object.position.toArray(), character: character.position.toArray() };
      }, name);
      await page.screenshot({ path: join(dir, `${label}-${name}.png`) });
    }
  } else {
    proof.windows = await page.evaluate(() => {
      const { scene, camera, character, follow, renderer, composer } = window.__graphicsAudit;
      const cottage = scene.getObjectByName('farm-cottage');
      follow(cottage.position);
      camera.zoom = 2;
      camera.updateProjectionMatrix();
      const canvas = document.createElement('canvas');
      canvas.width = renderer.domElement.width;
      canvas.height = renderer.domElement.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const pixels = () => {
        composer.render(0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(renderer.domElement, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const on = pixels();
      const entries = ['cottage-window-1', 'cottage-window-2', 'cottage-east-window'].map((name) => {
        const pane = scene.getObjectByName(name);
        const intensity = pane.material.emissiveIntensity;
        pane.material.emissiveIntensity = 0;
        const off = pixels();
        pane.material.emissiveIntensity = intensity;
        let changedPixels = 0; let sumOn = 0; let sumLift = 0; let maxOn = 0;
        for (let i = 0; i < on.length; i += 4) {
          const lum = (data) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          const lift = lum(on) - lum(off);
          if (lift <= 1) continue;
          changedPixels++;
          sumOn += lum(on);
          sumLift += lift;
          maxOn = Math.max(maxOn, lum(on));
        }
        return { name, intensity, emissive: pane.material.emissive.getHexString(),
          geometry: pane.geometry.parameters, changedPixels, meanLuminance: sumOn / changedPixels,
          meanEmissiveLift: sumLift / changedPixels, maxLuminance: maxOn };
      });
      composer.render(0);
      return entries;
    });
    await page.screenshot({ path: join(dir, `${label}.png`) });
  }
  await writeFile(join(dir, `${label}.json`), `${JSON.stringify(proof, null, 2)}\n`);
} finally {
  await context.close();
  await browser.close();
}
