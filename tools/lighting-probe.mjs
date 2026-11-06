import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Fast tuning aid: the same image regions as QA's analyzer, sampled from the
// actual native-resolution scene. The authoritative gate remains gfx-audit.
// Optional LIGHTING_TUNE is JSON keyed by phase; it changes only this page.
const url = process.env.LIGHTING_URL || 'http://100.88.150.21:5184';
const tune = JSON.parse(process.env.LIGHTING_TUNE || '{}');
const captureDir = process.env.LIGHTING_PROBE_CAPTURE;
if (captureDir) await mkdir(captureDir, { recursive: true });
const cases = [
  ['morning-clear', 'morning', 'clear'], ['day-clear', 'daytime', 'clear'],
  ['sunset-clear', 'sunset', 'clear'], ['night-clear', 'night', 'clear'],
  ['day-cloudy', 'daytime', 'cloudy'], ['day-rain', 'daytime', 'rain'], ['night-rain', 'night', 'rain'],
];
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const result = {};
try {
  for (const [name, phase, weatherName] of cases) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.route('**/src/main.ts*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\nwindow.__lightProbe = { scene, camera, character, controls, follow, renderer, composer, weather, dayNight };\n` });
      });
      await page.goto(`${url}/?phase=${phase}&weather=${weatherName}&pixel=0`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(window.__lightProbe));
      await page.evaluate(({ weatherName, values }) => {
        const { scene, character, renderer, weather, composer } = window.__lightProbe;
        renderer.setAnimationLoop(null);
        weather.update(1.75);
        const dir = scene.getObjectByName('day-night-directional');
        const amb = scene.getObjectByName('day-night-ambient');
        const hemi = scene.getObjectByName('day-night-hemisphere');
        const lantern = character.getObjectByName('lantern-light');
        const body = character.children.find((o) => o.geometry?.type === 'CapsuleGeometry');
        if (values.position) dir.position.set(...values.position);
        if (values.directional !== undefined) dir.intensity = values.directional * (weatherName === 'cloudy' ? 0.72 : weatherName === 'rain' ? (values.rainMultiplier ?? 0.8) : 1);
        if (values.ambient !== undefined) amb.intensity = values.ambient;
        if (values.hemisphere !== undefined) hemi.intensity = values.hemisphere;
        const assignColor = (color, value) => typeof value === 'string' ? color.set(value) : color.setHex(value);
        const setColor = (color, value) => {
          if (value === undefined) return;
          assignColor(color, value);
          if (weatherName === 'cloudy') { color.r *= 0.86; color.g *= 0.96; color.b *= 1.08; }
        };
        setColor(amb.color, values.ambientColor);
        setColor(hemi.color, values.skyColor);
        setColor(hemi.groundColor, values.groundColor);
        if (values.directionalColor !== undefined) assignColor(dir.color, values.directionalColor);
        if (values.bodyColor !== undefined) assignColor(body.material.color, values.bodyColor);
        if (values.bodyGain !== undefined) body.material.color.multiplyScalar(values.bodyGain);
        if (values.topGain !== undefined) {
          const position = body.geometry.getAttribute('position');
          const colors = new Float32Array(position.count * 3);
          for (let i = 0; i < position.count; i++) {
            const t = Math.max(0, Math.min(1, (position.getY(i) + 0.05) / 0.7));
            const factor = 1 + values.topGain * t * t * (3 - 2 * t);
            colors.set([factor, factor, factor], i * 3);
          }
          body.geometry.setAttribute('color', new position.constructor(colors, 3));
          body.material.vertexColors = true;
          body.material.needsUpdate = true;
        }
        if (values.lantern !== undefined) lantern.intensity = values.lantern;
        composer.render(0);
      }, { weatherName, values: { ...tune[phase], ...tune[name] } });
      const facings = {};
      let initialLight;
      for (const [facing, key] of [['toward_cam_S', 's'], ['away_W', 'w'], ['left_A', 'a'], ['right_D', 'd']]) {
        await page.keyboard.down(key);
        await page.evaluate(() => window.__lightProbe.controls.update(0.25));
        await page.keyboard.up(key);
        const info = await page.evaluate(() => {
          const { scene, camera, character, follow, renderer, composer, dayNight } = window.__lightProbe;
          follow(character.position);
          dayNight.updateCharacterShadow?.();
          camera.updateMatrixWorld();
          scene.updateMatrixWorld(true);
          composer.render(0);
          const body = character.children.find((o) => o.geometry?.type === 'CapsuleGeometry');
          const light = scene.getObjectByName('day-night-directional');
          const vector = () => character.position.clone();
          const proj = (v) => { const p = v.clone().project(camera); return [(p.x + 1) * 640, (1 - p.y) * 360]; };
          const bw = body.getWorldPosition(vector());
          const center = proj(bw);
          const top = proj(bw.clone().setY(bw.y + 1));
          const bottom = proj(bw.clone().setY(bw.y - 1));
          const right = camera.getWorldDirection(vector()).cross(camera.up).normalize();
          const side = proj(bw.clone().add(right.clone().multiplyScalar(0.4)));
          const r = Math.abs(side[0] - center[0]);
          const hh = Math.abs(bottom[1] - top[1]) / 2 * 0.7;
          const canvas = document.createElement('canvas');
          canvas.width = renderer.domElement.width;
          canvas.height = renderer.domElement.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(renderer.domElement, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const luma = (x, y) => { const i = (y * canvas.width + x) * 4; return 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]; };
          const region = (x0, x1, y0, y1) => {
            let sum = 0; let count = 0;
            for (let x = Math.trunc(x0); x < Math.trunc(x1); x++) for (let y = Math.trunc(y0); y < Math.trunc(y1); y++) { sum += luma(x, y); count++; }
            return sum / count;
          };
          const [cx, cy] = center;
          const left = region(cx - 0.85 * r, cx - 0.2 * r, cy - 0.3 * hh, cy + 0.3 * hh);
          const rightL = region(cx + 0.2 * r, cx + 0.85 * r, cy - 0.3 * hh, cy + 0.3 * hh);
          const topL = region(cx - 0.4 * r, cx + 0.4 * r, cy - 0.95 * hh, cy - 0.7 * hh);
          const ground = region(cx - 2.2 * r, cx - 1.6 * r, cy + 0.9 * hh, cy + 1.2 * hh);
          const worldRgb = (x, y, z) => {
            const [sx, sy] = proj(vector().set(x, y, z));
            const i = (Math.round(sy) * canvas.width + Math.round(sx)) * 4;
            return { screen: [sx, sy], rgb: [...pixels.slice(i, i + 3)] };
          };
          const pos = light.getWorldPosition(vector());
          const direction = pos.clone().sub(character.getWorldPosition(vector())).normalize();
          const sr = direction.dot(right);
          return { left, right: rightL, top: topL, ground, body: (left + rightL) / 2, sunScreenRight: sr,
            grass: worldRgb(-5.3, 2.405, 3.4),
            grassSamples: [[-6, -6], [6, -6], [-6, 6], [6, 6], [-5.3, 3.4], [-1, 5], [3, 5]]
              .map(([x, z]) => worldRgb(x, 2.405, z)), pond: worldRgb(4.2, 2.431, -3.55),
            position: character.position.toArray(), yaw: character.rotation.y };
        });
        initialLight ??= info.sunScreenRight;
        facings[facing] = info;
      }
      const away = facings.away_W;
      const sun = initialLight > 0 ? away.right : away.left;
      const shade = initialLight > 0 ? away.left : away.right;
      const body = Object.values(facings).map((v) => v.body);
      result[name] = { sun, shade, ratio: shade / sun, asymmetry: (sun - shade) / ((sun + shade) / 2),
        top: away.top, bodyToTop: away.body / away.top, ground: away.ground,
        contrast: (Math.max(away.body, away.ground) + 12.75) / (Math.min(away.body, away.ground) + 12.75),
        grass: away.grass, grassSamples: away.grassSamples, pond: away.pond,
        facings: Object.fromEntries(Object.entries(facings).map(([key, v]) => [key, v.body])),
        bodyToTopByFacing: Object.fromEntries(Object.entries(facings).map(([key, v]) => [key, v.body / v.top])),
        min: Math.min(...body), spread: (Math.max(...body) - Math.min(...body)) / Math.max(...body) };
      if (captureDir) {
        await page.evaluate(() => {
          const { character, follow, composer, dayNight } = window.__lightProbe;
          character.position.set(0, 2.4, 0);
          character.rotation.y = 0;
          follow(character.position);
          dayNight.updateCharacterShadow?.();
          window.setPixelRendering(true);
          composer.render(0);
        });
        await page.screenshot({ path: join(captureDir, `${name}.png`) });
      }
      await context.close();
    } catch (error) {
      await context.close();
      throw error;
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
