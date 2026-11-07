import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Fast tuning aid: the same image regions as QA's analyzer, sampled from the
// actual native-resolution scene. The authoritative gate remains gfx-audit.
// Optional LIGHTING_TUNE is JSON keyed by phase; it changes only this page.
const url = process.env.LIGHTING_URL || 'http://100.88.150.21:5184';
const tune = JSON.parse(process.env.LIGHTING_TUNE || '{}');
const captureDir = process.env.LIGHTING_PROBE_CAPTURE;
const only = process.env.LIGHTING_PROBE_ONLY ? process.env.LIGHTING_PROBE_ONLY.split(',') : undefined;
const maskRain = process.env.LIGHTING_PROBE_MASK_RAIN === '1';
if (captureDir) await mkdir(captureDir, { recursive: true });
const cases = [
  ['morning-clear', 'morning', 'clear'], ['day-clear', 'daytime', 'clear'],
  ['sunset-clear', 'sunset', 'clear'], ['night-clear', 'night', 'clear'],
  ['day-cloudy', 'daytime', 'cloudy'], ['day-rain', 'daytime', 'rain'], ['night-rain', 'night', 'rain'],
  ['morning-cloudy', 'morning', 'cloudy'], ['morning-rain', 'morning', 'rain'],
  ['sunset-cloudy', 'sunset', 'cloudy'], ['sunset-rain', 'sunset', 'rain'], ['night-cloudy', 'night', 'cloudy'],
];
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const result = {};
try {
  for (const [name, phase, weatherName] of cases) {
    if (only && !only.includes(name)) continue;
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => {
        let state = 0x1a2b3c4d;
        Math.random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x100000000; };
      });
      await page.route('**/src/main.ts*', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: `${await response.text()}\nwindow.__lightProbe = { scene, camera, character, controls, follow, renderer, composer, weather, dayNight };\n` });
      });
      await page.goto(`${url}/?phase=${phase}&weather=${weatherName}&pixel=0`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Boolean(window.__lightProbe));
      await page.evaluate(({ weatherName, values, maskRain }) => {
        const { scene, character, renderer, weather, composer } = window.__lightProbe;
        renderer.setAnimationLoop(null);
        weather.update(1.75);
        // For lighting-only checks, exclude random rain pixels without changing weather lighting.
        if (maskRain) scene.getObjectByName('weather-rain').visible = false;
        const dir = scene.getObjectByName('day-night-directional');
        const amb = scene.getObjectByName('day-night-ambient');
        const hemi = scene.getObjectByName('day-night-hemisphere');
        const lantern = character.getObjectByName('lantern-light');
        const body = character.children.find((o) => o.geometry?.type === 'CapsuleGeometry');
        if (values.position) dir.position.set(...values.position);
        if (values.directional !== undefined) dir.intensity = values.directional * (weatherName === 'cloudy' ? 0.72 : weatherName === 'rain' ? (values.rainMultiplier ?? 0.7) : 1);
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
        if (values.lanternDistance !== undefined) lantern.distance = values.lanternDistance;
        composer.render(0);
      }, { weatherName, values: { ...tune[phase], ...tune[name] }, maskRain });
      const spawn = await page.evaluate(() => {
        const { scene, camera, character, renderer, composer } = window.__lightProbe;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(); composer.render(0);
        const body = character.children.find((o) => o.geometry?.type === 'CapsuleGeometry');
        const vector = () => character.position.clone();
        const proj = (v) => { const p = v.clone().project(camera); return [(p.x + 1) * 640, (1 - p.y) * 360]; };
        const center = body.getWorldPosition(vector());
        const [cx, cy] = proj(center);
        const top = proj(center.clone().setY(center.y + 0.7));
        const bottom = proj(center.clone().setY(center.y - 0.7));
        const right = camera.getWorldDirection(vector()).cross(camera.up).normalize();
        const r = Math.abs(proj(center.clone().addScaledVector(right, 0.4))[0] - cx);
        const hh = Math.abs(bottom[1] - top[1]) / 2;
        const canvas = document.createElement('canvas'); canvas.width = renderer.domElement.width; canvas.height = renderer.domElement.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const measure = () => {
          composer.render(0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(renderer.domElement, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const region = (x0, x1, y0, y1) => {
            let sum = 0; let count = 0;
            for (let x = Math.trunc(x0); x < Math.trunc(x1); x++) for (let y = Math.trunc(y0); y < Math.trunc(y1); y++) {
              const i = (y * canvas.width + x) * 4;
              sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]; count++;
            }
            return sum / count;
          };
          const face = region(cx - 0.5 * r, cx + 0.5 * r, cy - 0.25 * hh, cy + 0.45 * hh);
          const crown = region(cx - 0.4 * r, cx + 0.4 * r, cy - 0.95 * hh, cy - 0.7 * hh);
          return { face, crown, faceToTop: face / crown };
        };
        const visible = measure();
        // The red comb and gold wings are not the yellow body's moon-lit
        // crown. Preserve the full-frame reading while independently measuring
        // the existing body rule without the new accent materials.
        const details = ['character-comb', 'character-wing-left', 'character-wing-right']
          .map((name) => character.getObjectByName(name)).filter(Boolean);
        const states = details.map((part) => part.visible);
        details.forEach((part) => { part.visible = false; });
        const bodyOnly = measure();
        details.forEach((part, index) => { part.visible = states[index]; });
        composer.render(0);
        return { ...visible, bodyOnly };
      });
      const facings = {};
      let initialLight;
      const facingsToProbe = process.env.LIGHTING_QA_POSE ?
        [['away_W', 'w'], ['toward_cam_S', 's'], ['left_A', 'a'], ['right_D', 'd']] :
        [['toward_cam_S', 's'], ['away_W', 'w'], ['left_A', 'a'], ['right_D', 'd']];
      for (const [facing, key] of facingsToProbe) {
        await page.keyboard.down(key);
        await page.evaluate((step) => window.__lightProbe.controls.update(step), Number(process.env.LIGHTING_QA_STEP || 0.25));
        await page.keyboard.up(key);
        const info = await page.evaluate(() => {
          const { scene, camera, character, follow, renderer, composer, dayNight, weather } = window.__lightProbe;
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
          const regionRgb = (x0, x1, y0, y1) => {
            const sums = [0, 0, 0]; let count = 0;
            for (let x = Math.trunc(x0); x < Math.trunc(x1); x++) for (let y = Math.trunc(y0); y < Math.trunc(y1); y++) {
              const offset = (y * canvas.width + x) * 4;
              for (let channel = 0; channel < 3; channel++) sums[channel] += pixels[offset + channel];
              count++;
            }
            return sums.map((sum) => sum / count);
          };
          const [cx, cy] = center;
          const left = region(cx - 0.85 * r, cx - 0.2 * r, cy - 0.3 * hh, cy + 0.3 * hh);
          const rightL = region(cx + 0.2 * r, cx + 0.85 * r, cy - 0.3 * hh, cy + 0.3 * hh);
          const topL = region(cx - 0.4 * r, cx + 0.4 * r, cy - 0.95 * hh, cy - 0.7 * hh);
          const faceL = region(cx - 0.5 * r, cx + 0.5 * r, cy - 0.25 * hh, cy + 0.45 * hh);
          const ground = region(cx - 2.2 * r, cx - 1.6 * r, cy + 0.9 * hh, cy + 1.2 * hh);
          const leftRgb = regionRgb(cx - 0.85 * r, cx - 0.2 * r, cy - 0.3 * hh, cy + 0.3 * hh);
          const rightRgb = regionRgb(cx + 0.2 * r, cx + 0.85 * r, cy - 0.3 * hh, cy + 0.3 * hh);
          const bodyRgb = leftRgb.map((value, i) => (value + rightRgb[i]) / 2);
          const topRgb = regionRgb(cx - 0.4 * r, cx + 0.4 * r, cy - 0.95 * hh, cy - 0.7 * hh);
          let palePixels = 0; let topPixels = 0;
          for (let x = Math.trunc(cx - 0.4 * r); x < Math.trunc(cx + 0.4 * r); x++) {
            for (let y = Math.trunc(cy - 0.95 * hh); y < Math.trunc(cy - 0.7 * hh); y++) {
              const i = (y * canvas.width + x) * 4;
              if (pixels[i] >= 250 && pixels[i + 1] >= 245) palePixels++;
              topPixels++;
            }
          }
          const groundRgb = regionRgb(cx - 2.2 * r, cx - 1.6 * r, cy + 0.9 * hh, cy + 1.2 * hh);
          // Same median samples, gamma and CIE76 conversion as QA's
          // analyze-gate.py C4; unlike the probe's older rectangular contrast.
          const medianRgb = (points) => {
            const samples = points.map(([x, y]) => {
              const offset = (Math.max(0, Math.min(canvas.height - 1, Math.trunc(y))) * canvas.width +
                Math.max(0, Math.min(canvas.width - 1, Math.trunc(x)))) * 4;
              return [...pixels.slice(offset, offset + 3)];
            });
            return [0, 1, 2].map((channel) => samples.map((sample) => sample[channel]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]);
          };
          const qaBodyRgb = medianRgb([-0.5, 0, 0.5].flatMap((x) => [-0.5, -0.2, 0.2, 0.5].map((y) => [cx + x * r, cy + y * hh])));
          const qaGroundRgb = medianRgb([[cx - 2.4 * r, cy + 0.9 * hh], [cx - 2.4 * r, cy + 0.4 * hh],
            [cx - 1.6 * r, cy + 1.35 * hh], [cx - 0.3 * r, cy + 1.6 * hh],
            [cx - 2.4 * r, cy - 0.3 * hh], [cx, cy - 1.8 * hh]]);
          const linear = (color) => color.map((channel) => (channel / 255) ** 2.2);
          const luminance = ([red, green, blue]) => 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          const lab = (color) => {
            const [red, green, blue] = linear(color);
            const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
            const x = f((0.4124 * red + 0.3576 * green + 0.1805 * blue) / 0.95047);
            const y = f(luminance([red, green, blue]));
            const z = f((0.0193 * red + 0.1192 * green + 0.9505 * blue) / 1.08883);
            return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
          };
          const bodyL = luminance(linear(qaBodyRgb));
          const groundL = luminance(linear(qaGroundRgb));
          const bodyLab = lab(qaBodyRgb); const groundLab = lab(qaGroundRgb);
          const qaContrast = (Math.max(bodyL, groundL) + 0.05) / (Math.min(bodyL, groundL) + 0.05);
          const qaDeltaE = Math.hypot(...bodyLab.map((value, i) => value - groundLab[i]));
          const worldRgb = (x, y, z) => {
            const [sx, sy] = proj(vector().set(x, y, z));
            const i = (Math.round(sy) * canvas.width + Math.round(sx)) * 4;
            return { screen: [sx, sy], rgb: [...pixels.slice(i, i + 3)] };
          };
          const pos = light.getWorldPosition(vector());
          const direction = pos.clone().sub(character.getWorldPosition(vector())).normalize();
          const sr = direction.dot(right);
          // EBR-70's shelter covers the old (-5.3, 3.4) grass sample. Keep the
          // same lighting thresholds, but sample unobstructed grass east of it.
          const grass = worldRgb(-1, 2.405, 5);
          const grassReferenceRgb = medianRgb(Array.from({ length: 13 * 13 }, (_, i) =>
            [Math.trunc(grass.screen[0]) + i % 13 - 6, Math.trunc(grass.screen[1]) + Math.floor(i / 13) - 6]));
          const shadeLab = lab(sr > 0 ? leftRgb : rightRgb); const grassLab = lab(grassReferenceRgb);
          const shadeGrassDeltaE = Math.hypot(...shadeLab.map((value, i) => value - grassLab[i]));
          const shadow = character.getObjectByName('character-shadow');
          const shadowDelta = shadow.getWorldPosition(vector()).sub(character.getWorldPosition(vector())).setY(0);
          const awayFromKey = light.target.getWorldPosition(vector()).sub(pos).setY(0).normalize();
          return { left, right: rightL, top: topL, face: faceL, topRgb, paleFraction: palePixels / topPixels, ground, body: (left + rightL) / 2, bodyRgb, leftRgb, rightRgb, groundRgb, sunScreenRight: sr, shadeGrassDeltaE, grassReferenceRgb,
            qa: { bodyRgb: qaBodyRgb, groundRgb: qaGroundRgb, contrast: qaContrast, deltaE: qaDeltaE },
            bodyColor: body.material.color.getHexString(),
            grass, cottageFront: worldRgb(-4.6, 2.95, -1.89), cottageSide: worldRgb(-1.19, 3.3, -3.4),
            grassSamples: [[-6, -6], [6, -6], [-1.5, 6.5], [6, 6], [-0.5, 3.7], [-1, 5], [3, 5]]
              .map(([x, z]) => worldRgb(x, 2.405, z)), pond: worldRgb(4.2, 2.431, -3.55),
            // This point is unobstructed by the foreground tree canopy.
            stream: scene.getObjectByName('farm-stream-water') ? worldRgb(2.85, 2.431, 2) : null,
            streamSamples: scene.getObjectByName('farm-stream-water') ?
              [[3.6, -0.8], [3.1, 0.6], [2.85, 2], [2.9, 3.6], [3.25, 5.3], [3.55, 6.8], [3.6, 7.7]]
                .map(([x, z]) => worldRgb(x, 2.431, z)) : null,
            waterfall: scene.getObjectByName('farm-waterfall-face') ? worldRgb(3.6, 1.0, 8.06) : null,
            lightPosition: pos.toArray(), lightIntensity: light.intensity, weather: weather.getWeather(),
            rainParticlesVisible: scene.getObjectByName('weather-rain').visible,
            shadowOffset: shadowDelta.toArray(), shadowLength: shadowDelta.length(),
            shadowCosine: shadowDelta.length() > 1e-6 ? shadowDelta.normalize().dot(awayFromKey) : 0,
            shadowOpacity: shadow.material.opacity, position: character.position.toArray(), yaw: character.rotation.y };
        });
        initialLight ??= info.sunScreenRight;
        facings[facing] = info;
      }
      const away = facings.away_W;
      const sun = initialLight > 0 ? away.right : away.left;
      const shade = initialLight > 0 ? away.left : away.right;
      const body = Object.values(facings).map((v) => v.body);
      result[name] = { sun, shade, ratio: shade / sun, asymmetry: (sun - shade) / ((sun + shade) / 2),
        top: away.top, topRgb: away.topRgb, paleFraction: away.paleFraction, bodyToTop: away.body / away.top, ground: away.ground,
        contrast: (Math.max(away.body, away.ground) + 12.75) / (Math.min(away.body, away.ground) + 12.75),
        bodyRgb: away.bodyRgb, shadeRgb: initialLight > 0 ? away.leftRgb : away.rightRgb,
        qa: away.qa, bodyColor: away.bodyColor,
        groundRgb: away.groundRgb, grass: away.grass, grassSamples: away.grassSamples,
        shadeGrassDeltaE: away.shadeGrassDeltaE, grassReferenceRgb: away.grassReferenceRgb,
        cottageFront: away.cottageFront, cottageSide: away.cottageSide,
        pond: away.pond, stream: away.stream, streamSamples: away.streamSamples, waterfall: away.waterfall,
        lightPosition: away.lightPosition, lightIntensity: away.lightIntensity, weather: away.weather,
        rainParticlesVisible: away.rainParticlesVisible, shadowOffset: away.shadowOffset,
        shadowLength: away.shadowLength, shadowCosine: away.shadowCosine, shadowOpacity: away.shadowOpacity,
        facings: Object.fromEntries(Object.entries(facings).map(([key, v]) => [key, v.body])),
        shadeRgbByFacing: Object.fromEntries(Object.entries(facings).map(([key, v]) => [key, initialLight > 0 ? v.leftRgb : v.rightRgb])),
        bodyToTopByFacing: Object.fromEntries(Object.entries(facings).map(([key, v]) => [key, v.body / v.top])),
        faceToTop: facings.toward_cam_S.face / facings.toward_cam_S.top,
        faceToTopByFacing: Object.fromEntries(Object.entries(facings).map(([key, v]) => [key, v.face / v.top])),
        spawn,
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
