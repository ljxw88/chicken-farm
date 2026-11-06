// Reproducible EBR-92 evidence. Run against a Vite source server:
//   node evidence/EBR-92/capture.mjs http://100.88.150.21:5211 before
// Uses Gate G's weather seed, manual animation timestamps and real input. The
// bodyless companions are rendered in the same frozen scene for pixel masks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { approachStairsAcrossBridge } from '../../tools/parity-bridge-route.mjs';
import { formatCapture } from './format-capture.mjs';

const [url, label] = process.argv.slice(2);
if (!url || !label) throw new Error('Usage: capture.mjs <Vite URL> <label>');
// Optional test-only tuning of the current 1.08 linear base gain. This does
// not alter source, lights, weather or the crown gradient.
const trialGain = process.env.EBR92_TEST_BASE_GAIN ? Number(process.env.EBR92_TEST_BASE_GAIN) : undefined;
const onlyDay = process.env.EBR92_ONLY_DAY === '1';
const out = join('evidence/EBR-92', label);
for (const sub of ['gate-g', 'gate-g-bodyless', 'frames', 'bodyless', 'crisp', 'crisp-bodyless']) {
  await mkdir(join(out, sub), { recursive: true });
}
const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const report = { label, base: url, browser: browser.version(), viewport: [1280, 720], dpr: 1,
  sourceSha, seed: '0xeb730001', trialBaseGain: trialGain, gate: {}, phases: {}, errors: [] };

async function open(search) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(() => {
    let state = 0xeb730001;
    window.__ebr73RandomCalls = 0;
    window.__ebr73Random = () => {
      window.__ebr73RandomCalls++;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr73Step = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame was scheduled');
      for (const callback of current) callback(time);
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
    await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr73Random,')}
window.__ebr73Parity = { scene, camera, character, controls, follow, stairs, renderer, composer, placement };
` });
  });
  await page.goto(`${url}/${search}`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => Boolean(window.__ebr73Parity)));
  assert.ok(await page.evaluate(() => window.__ebr73RandomCalls > 0));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__ebr73Step(0));
  if (trialGain !== undefined && search.includes('phase=daytime')) {
    await page.evaluate((gain) => {
      const { character, composer } = window.__ebr73Parity;
      character.children.find((child) => child.geometry?.type === 'CapsuleGeometry').material.color.multiplyScalar(gain / 1.08);
      composer.render(0);
    }, trialGain);
  }
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp, errors };
}

async function screenshot(cdp, path) {
  const result = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const bytes = Buffer.from(result.data, 'base64');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1280, 720]);
  await writeFile(path, bytes);
}

async function bodyVisible(page, visible) {
  await page.evaluate((value) => {
    const { character, composer } = window.__ebr73Parity;
    character.children.find((child) => child.geometry?.type === 'CapsuleGeometry').visible = value;
    composer.render(0);
  }, visible);
}

const scenarios = [
  { name: 'spawn', search: '?phase=daytime&weather=clear', setup: 'spawn' },
  { name: 'stairs-pad', search: '?phase=daytime&weather=clear', setup: 'stairs' },
  { name: 'placement-ghost', search: '?phase=daytime&weather=clear', setup: 'placement' },
  { name: 'day', search: '?phase=daytime&weather=clear', setup: 'walk' },
  { name: 'night', search: '?phase=night&weather=clear', setup: 'spawn' },
  { name: 'rain', search: '?phase=daytime&weather=rain', setup: 'rain' },
  { name: 'cottage-coops-day', search: '?phase=daytime&weather=clear', setup: 'buildings' },
  { name: 'cottage-coops-night', search: '?phase=night&weather=clear', setup: 'buildings' },
];

try {
  for (const scenario of onlyDay ? [] : scenarios) {
    const { context, page, cdp, errors } = await open(scenario.search);
    try {
      if (scenario.setup === 'stairs') {
        await approachStairsAcrossBridge(page, '__ebr73Parity', '__ebr73Step');
        assert.ok(await page.evaluate(() => {
          const { character, stairs } = window.__ebr73Parity;
          return Math.hypot(character.position.x - stairs.footPad.position.x, character.position.z - stairs.footPad.position.z) < 0.03;
        }));
      } else if (scenario.setup === 'placement') {
        await page.keyboard.press('f');
        await page.mouse.move(449, 381);
        assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
        await page.evaluate(() => window.__ebr73Step(100));
      } else if (scenario.setup === 'walk') {
        await page.keyboard.down('s');
        await page.evaluate(() => { for (let i = 1; i <= 8; i++) window.__ebr73Step(i * 100); });
        await page.keyboard.up('s');
      } else if (scenario.setup === 'rain') {
        await page.evaluate(() => { for (let i = 1; i <= 25; i++) window.__ebr73Step(i * 100); });
        assert.equal(await page.evaluate(() => window.getWeather().rainAmount), 1);
      } else if (scenario.setup === 'buildings') {
        await page.evaluate(() => {
          const { camera, character, follow, composer } = window.__ebr73Parity;
          follow(character.position.clone().set(-1.45, 2.4, -3.4));
          camera.zoom = 1.8;
          camera.updateProjectionMatrix();
          composer.render(0);
        });
      }
      report.gate[scenario.name] = await page.evaluate(() => {
        const { character, camera } = window.__ebr73Parity;
        return { position: character.position.toArray(), yaw: character.rotation.y, camera: camera.position.toArray(),
          cameraQuaternion: camera.quaternion.toArray(), cameraZoom: camera.zoom,
          pixel: window.getPixelRendering(), weather: window.getWeather() };
      });
      await screenshot(cdp, join(out, 'gate-g', `${scenario.name}.png`));
      await bodyVisible(page, false);
      await screenshot(cdp, join(out, 'gate-g-bodyless', `${scenario.name}.png`));
      assert.deepEqual(errors, [], scenario.name);
    } finally {
      await context.close();
    }
    console.log('Gate G', scenario.name);
  }

  const phases = [
    ['morning-clear', 'morning', 'clear'], ['morning-cloudy', 'morning', 'cloudy'],
    ['morning-rain', 'morning', 'rain'], ['daytime-clear', 'daytime', 'clear'],
    ['daytime-cloudy', 'daytime', 'cloudy'], ['daytime-rain', 'daytime', 'rain'],
    ['sunset-clear', 'sunset', 'clear'], ['sunset-cloudy', 'sunset', 'cloudy'],
    ['sunset-rain', 'sunset', 'rain'], ['night-clear', 'night', 'clear'],
    ['night-cloudy', 'night', 'cloudy'], ['night-rain', 'night', 'rain'],
  ];
  for (const [name, phase, weather] of phases) {
    if (onlyDay && phase !== 'daytime') continue;
    const { context, page, cdp, errors } = await open(`?phase=${phase}&weather=${weather}`);
    try {
      await page.evaluate(() => { for (let i = 1; i <= 25; i++) window.__ebr73Step(i * 100); });
      for (const facing of ['toward', 'away']) {
        if (facing === 'away') {
          await page.keyboard.down('w');
          // Match the clean-main QA matrix's measured W travel (~0.817 u),
          // rather than its load-dependent wall-clock input duration.
          await page.evaluate(() => { for (const time of [2600, 2700, 2733.4]) window.__ebr73Step(time); });
          await page.keyboard.up('w');
        }
        const key = `${name}-${facing}`;
        await screenshot(cdp, join(out, 'frames', `${key}.png`));
        await bodyVisible(page, false);
        await screenshot(cdp, join(out, 'bodyless', `${key}.png`));
        await bodyVisible(page, true);

        // Rain weather remains fully applied, but the foreground particle layer
        // is hidden for objective colour and shade/lit measurements only.
        const rainWasVisible = await page.evaluate(() => {
          const { scene, composer } = window.__ebr73Parity;
          const rain = scene.getObjectByName('weather-rain');
          const visible = rain.visible;
          rain.visible = false;
          window.setPixelRendering(false);
          composer.render(0);
          return visible;
        });
        const info = await page.evaluate(async () => {
          const THREE = await import('/node_modules/three/build/three.module.js');
          const { scene, camera, character } = window.__ebr73Parity;
          scene.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          const body = character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
          const origin = character.getWorldPosition(new THREE.Vector3());
          const center = body.getWorldPosition(new THREE.Vector3());
          const project = (point) => {
            const p = point.clone().project(camera);
            return [(p.x + 1) * 640, (1 - p.y) * 360];
          };
          const right = camera.getWorldDirection(new THREE.Vector3()).cross(camera.up).normalize();
          const bodyScreen = { c: project(center), top: project(center.clone().setY(center.y + 0.7)),
            bot: project(center.clone().setY(center.y - 0.7)),
            r: Math.abs(project(center.clone().addScaledVector(right, 0.4))[0] - project(center)[0]) };
          const ray = new THREE.Raycaster();
          const pointer = new THREE.Vector2();
          const samples = new Map();
          const visible = (object) => {
            for (let current = object; current; current = current.parent) if (!current.visible) return false;
            return true;
          };
          // Uniform 0.1-unit world grid in an annulus around the feet. Keep
          // only visible grass/path intersections, not bodies, props or water.
          for (let ix = -15; ix <= 15; ix++) for (let iz = -15; iz <= 15; iz++) {
            const radius = Math.hypot(ix, iz) / 10;
            if (radius < 0.7 || radius > 1.5) continue;
            const [sx, sy] = project(new THREE.Vector3(origin.x + ix / 10, origin.y + 0.03, origin.z + iz / 10));
            const x = Math.floor(sx); const y = Math.floor(sy);
            if (x < 0 || x >= 1280 || y < 0 || y >= 720) continue;
            pointer.set((x + 0.5) / 640 - 1, 1 - (y + 0.5) / 360);
            ray.setFromCamera(pointer, camera);
            const hit = ray.intersectObjects(scene.children, true).find((item) => {
              if (!item.object.isMesh || !visible(item.object)) return false;
              // A transparent contact blob overlays, rather than replaces, the ground.
              return item.object.geometry.type !== 'CircleGeometry';
            });
            if (!hit || !(hit.object.name === 'island-top' || hit.object.name.startsWith('farm-path-'))) continue;
            const distance = Math.hypot(hit.point.x - origin.x, hit.point.z - origin.z);
            if (distance < 0.7 || distance > 1.5) continue;
            samples.set(`${x},${y}`, { x, y, surface: hit.object.name, distance });
          }
          const light = scene.getObjectByName('day-night-directional');
          const sun = light.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
          return { bodyScreen, sunRight: sun.dot(right), position: origin.toArray(), yaw: character.rotation.y,
            weather: window.getWeather(), bodyHex: body.material.color.getHexString(),
            groundSamples: [...samples.values()] };
        });
        assert.ok(info.groundSamples.length > 40, `${key}: too few visible grass/path samples`);
        report.phases[key] = info;
        await screenshot(cdp, join(out, 'crisp', `${key}.png`));
        await bodyVisible(page, false);
        await screenshot(cdp, join(out, 'crisp-bodyless', `${key}.png`));
        await bodyVisible(page, true);
        await page.evaluate((visible) => {
          const { scene, composer } = window.__ebr73Parity;
          scene.getObjectByName('weather-rain').visible = visible;
          window.setPixelRendering(true);
          composer.render(0);
        }, rainWasVisible);
      }
      assert.deepEqual(errors, [], name);
    } finally {
      await context.close();
    }
    console.log('Phase/facing', name);
  }
  await writeFile(join(out, 'capture.json'), formatCapture(report));
} finally {
  await browser.close();
}
