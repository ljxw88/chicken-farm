import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const historicalSha = 'dcbaf70b8f2c1038afe5c0b70f506ec7de931214';
const mergedMainSha = '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff';
const viewport = { width: 1280, height: 720 };
const seed = 0xeb750001;
const phases = ['morning', 'daytime', 'sunset', 'night'];
const modes = ['clear', 'cloudy', 'rain'];
const canonical = (value) => JSON.parse(JSON.stringify(value));

async function serverAt(root) {
  const server = await createServer({ root, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== 'string');
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function open(browser, url, search, normalizeClock = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  await page.addInitScript(({ seed }) => {
    let randomState = seed >>> 0;
    window.__ebr75RandomCalls = 0;
    window.__ebr75Random = () => {
      window.__ebr75RandomCalls++;
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      return randomState / 0x100000000;
    };
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__ebr75Step = (time) => {
      const current = [...callbacks.values()];
      callbacks.clear();
      if (!current.length) throw new Error('No animation frame was scheduled');
      for (const callback of current) callback(time);
    };
    window.__ebr75Sample = () => {
      const { scene, camera, character, obstacles, dayNight } = window.__ebr75;
      const layer = scene.getObjectByName('placement-layer');
      const ghost = scene.getObjectByName('placement-ghost');
      const wash = scene.getObjectByName('placement-wash');
      const ambient = scene.getObjectByName('day-night-ambient');
      const hemisphere = scene.getObjectByName('day-night-hemisphere');
      const directional = scene.getObjectByName('day-night-directional');
      const shadow = character.getObjectByName('character-shadow');
      const streaks = scene.getObjectByName('rain-streaks');
      const visual = (object) => object && ({ name: object.name, visible: object.visible,
        position: object.position.toArray(), rotation: object.rotation.y,
        parts: object.children.map((part) => ({ color: part.material?.color?.getHex() ?? null,
          opacity: part.material?.opacity ?? null, transparent: part.material?.transparent ?? null })) });
      const button = (name) => {
        const node = document.querySelector(`[data-${name}]`);
        return { disabled: node.disabled, pressed: node.getAttribute('aria-pressed') };
      };
      const splashes = Array.from({ length: 6 }, (_, i) => scene.getObjectByName(`rain-splash-${i + 1}`))
        .map((ring) => ({ visible: ring.visible, position: ring.position.toArray(), scale: ring.scale.toArray(), opacity: ring.material.opacity }));
      return {
        character: { position: character.position.toArray(), yaw: character.rotation.y },
        camera: camera.position.toArray(),
        placement: {
          status: document.querySelector('.placement-status').textContent,
          detailHidden: document.querySelector('.placement-detail').hidden,
          buttons: Object.fromEntries(['fence', 'plot', 'rotate', 'confirm', 'remove', 'undo'].map((name) => [name, button(name)])),
          ghost: visual(ghost),
          wash: { visible: wash.visible, position: wash.position.toArray(), scale: wash.scale.toArray(),
            color: wash.material.color.getHex(), opacity: wash.material.opacity },
          children: layer.children.map((child) => child.name),
          placed: layer.children.filter((child) => child.name.startsWith('placed-')).map(visual),
          collisions: obstacles.filter((obstacle) => obstacle.name.startsWith('placed-fence-')),
        },
        environment: {
          phase: dayNight.getPhase(), hud: document.querySelector('[data-phase]').textContent,
          weather: window.getWeather(), background: scene.background.toArray(),
          fog: { color: scene.fog.color.toArray(), density: scene.fog.density },
          ambient: { color: ambient.color.toArray(), intensity: ambient.intensity },
          hemisphere: { sky: hemisphere.color.toArray(), ground: hemisphere.groundColor.toArray(), intensity: hemisphere.intensity },
          directional: { color: directional.color.toArray(), intensity: directional.intensity, position: directional.position.toArray() },
          shadow: { position: shadow.position.toArray(), rotation: shadow.rotation.z, scale: shadow.scale.toArray(), opacity: shadow.material.opacity },
          windowLights: ['window-light-1', 'window-light-2', 'lantern-light'].map((name) => scene.getObjectByName(name).intensity),
          accents: ['cottage-window-1', 'cottage-window-2', 'cottage-east-window', 'ramp-coop-1-pop-hole-glow', 'ramp-coop-2-pop-hole-glow']
            .map((name) => scene.getObjectByName(name).material.emissiveIntensity),
          rain: { visible: streaks.visible, opacity: streaks.material.opacity,
            positions: streaks.visible ? Array.from(streaks.geometry.attributes.position.array) : [], splashes },
          randomCalls: window.__ebr75RandomCalls,
        },
      };
    };
  }, { seed });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    assert.equal((body.match(/\bcreateWeatherSystem\(\{/g) ?? []).length, 1);
    await route.fulfill({ response, body: `${body.replace(/\bcreateWeatherSystem\(\{/, 'createWeatherSystem({ random: window.__ebr75Random,')}
window.__ebr75 = { scene, camera, character, obstacles, stairs, dayNight, composer };
` });
  });
  // This is a scene/placement replay, so use the real HUD-free gate flag.
  await page.goto(`${url}/${search}${search.includes('?') ? '&' : '?'}skyhud=0`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => window.__ebr75 && window.__ebr75RandomCalls > 0));
  // The sky ticket intentionally changes the app default to 1440s. Compare
  // invalid-URL behavior at the same explicit speed as the old baseline.
  if (normalizeClock) await page.evaluate(() => window.setDayNightCycleSeconds(72));
  await page.evaluate(() => document.fonts.ready);
  const graphics = await page.evaluate(() => {
    const gl = document.querySelector('#scene').getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug && gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), pixel: window.getPixelRendering() };
  });
  assert.match(graphics.renderer, /SwiftShader/i);
  assert.deepEqual([graphics.pixel.canvasWidth, graphics.pixel.canvasHeight, graphics.pixel.devicePixelRatio], [320, 180, 1]);
  return { context, page, errors };
}

async function perform(fixture, action) {
  const { page } = fixture;
  let outcome = null;
  if (action.type === 'frames') {
    const samples = await page.evaluate((times) => times.map((time) => {
      window.__ebr75Step(time);
      return window.__ebr75Sample();
    }), action.times);
    return { label: action.label, outcome, samples };
  }
  if (action.type === 'key') await page.keyboard.press(action.key);
  else if (action.type === 'hover') await page.mouse.move(action.x, action.y);
  else if (action.type === 'click') await page.mouse.click(action.x, action.y);
  else if (action.type === 'touch') {
    await page.dispatchEvent('#scene', 'pointerdown', { bubbles: true, cancelable: true, isPrimary: true,
      button: 0, pointerType: 'touch', clientX: action.x, clientY: action.y });
  } else if (action.type === 'button') {
    await page.evaluate((name) => {
      const button = document.querySelector(`[data-${name}]`);
      if (!button || button.disabled) throw new Error(`Unavailable button: ${name}`);
      button.click();
    }, action.name);
  } else if (action.type === 'setter') {
    outcome = await page.evaluate(({ name, args }) => {
      try { window[name](...args); return { ok: true }; }
      catch (error) { return { ok: false, name: error.name, message: error.message }; }
    }, action);
  } else throw new Error(`Unknown replay action: ${action.type}`);
  return { label: action.label, outcome, samples: [await page.evaluate(() => window.__ebr75Sample())] };
}

async function capture(fixture, { hideBody = false, hideRain = false } = {}) {
  const visibility = await fixture.page.evaluate(({ hideBody, hideRain }) => {
    const { scene, character, composer } = window.__ebr75;
    const body = character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
    const rain = scene.getObjectByName('weather-rain');
    const previous = { body: body.visible, rain: rain.visible };
    if (hideBody) body.visible = false;
    if (hideRain) rain.visible = false;
    composer.render(0);
    return previous;
  }, { hideBody, hideRain });
  const cdp = await fixture.context.newCDPSession(fixture.page);
  try {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    return Buffer.from(screenshot.data, 'base64');
  } finally {
    await cdp.detach();
    if (hideBody || hideRain) await fixture.page.evaluate((previous) => {
      const { scene, character, composer } = window.__ebr75;
      character.children.find((child) => child.geometry?.type === 'CapsuleGeometry').visible = previous.body;
      scene.getObjectByName('weather-rain').visible = previous.rain;
      composer.render(0);
    }, visibility);
  }
}

async function recordScenario(browser, url, scenario, replayScript, historical) {
  const fixture = await open(browser, url, scenario.search, scenario.name === 'invalid-url');
  const { page } = fixture;
  const script = [];
  const trace = [];
  const captures = {};
  const bodylessCaptures = {};
  const rainlessCaptures = {};
  const bothHiddenCaptures = {};
  const bodyShape = await page.evaluate(() => {
    const body = window.__ebr75.character.children.find((child) => child.geometry?.type === 'CapsuleGeometry');
    const geometry = body.geometry;
    return { position: body.position.toArray(), rotation: body.rotation.toArray(), scale: body.scale.toArray(),
      positions: Array.from(geometry.getAttribute('position').array), normals: Array.from(geometry.getAttribute('normal').array),
      indices: Array.from(geometry.index.array), material: { type: body.material.type, color: body.material.color.getHex(),
        emissive: body.material.emissive.getHex(), roughness: body.material.roughness, metalness: body.material.metalness,
        side: body.material.side, opacity: body.material.opacity, transparent: body.material.transparent,
        vertexColors: body.material.vertexColors, shadeShader: body.material.onBeforeCompile.toString() } };
  });
  let time = 0;
  async function run(action) {
    if (action.type !== 'capture') return perform(fixture, action);
    captures[action.label] = await capture(fixture);
    bodylessCaptures[action.label] = await capture(fixture, { hideBody: true });
    // The older EBR-75 reference predates EBR-88. Isolate its already-approved
    // rain layer as well as the EBR-92 body, without allowing other changes.
    if (historical && await page.evaluate(() => window.getWeather().rainAmount > 0)) {
      rainlessCaptures[action.label] = await capture(fixture, { hideRain: true });
      bothHiddenCaptures[action.label] = await capture(fixture, { hideBody: true, hideRain: true });
    }
    return { label: action.label, outcome: null, samples: [await page.evaluate(() => window.__ebr75Sample())] };
  }
  async function emit(action) {
    script.push(action);
    trace.push(await run(action));
  }
  async function shot(label) { await emit({ type: 'capture', label }); }
  async function frames(label, count, delta) {
    const times = Array.from({ length: count }, () => { time += delta; return time; });
    await emit({ type: 'frames', label, times });
  }
  async function point(x, z, y = 2.4) {
    const result = await page.evaluate(({ x, y, z }) => {
      const { camera, character } = window.__ebr75;
      camera.updateMatrixWorld();
      const p = character.position.clone().set(x, y, z).project(camera);
      const rect = document.querySelector('#scene').getBoundingClientRect();
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    }, { x, y, z });
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, result), 'scene',
      `The ${x},${z} replay target must be on the canvas`);
    return result;
  }
  async function pointer(type, label, x, z) { await emit({ type, label, ...await point(x, z) }); }
  async function key(label, key) { await emit({ type: 'key', label, key }); }
  async function setter(label, name, ...args) { await emit({ type: 'setter', label, name, args }); }
  try {
    if (replayScript) {
      for (const action of replayScript) trace.push(await run(action));
    } else {
      await emit({ type: 'frames', label: 'initial', times: [0] });
      if (scenario.name === 'placement') {
        await pointer('click', 'walk-target', -4, 5);
        await key('select-fence', 'f');
        await frames('placement-cancels-walk', 2, 100);
        await pointer('hover', 'valid-fence', -4, 5);
        await shot('preview-valid');
        await key('rotated-fence', 'r');
        await shot('preview-rotated');
        await pointer('hover', 'blocked-player', -0.75, 0.75);
        await shot('preview-player');
        await pointer('hover', 'blocked-deck', 3.9, -1.95);
        await shot('preview-deck');
        await pointer('hover', 'blocked-water', 3, 0.6);
        await shot('preview-water');
        await pointer('hover', 'blocked-cottage', -3.4, -3.4);
        await shot('preview-cottage');
        await pointer('hover', 'valid-before-place', -4, 5);
        await pointer('click', 'placed-fence', -4, 5);
        await shot('placed-fence-frame');
        await key('select-plot', 'p');
        await pointer('touch', 'touch-preview-plot', -5.25, 3.75);
        await shot('touch-preview');
        await emit({ type: 'button', label: 'touch-rotate-plot', name: 'rotate' });
        await shot('touch-rotated');
        await emit({ type: 'button', label: 'touch-confirm-plot', name: 'confirm' });
        await shot('placed-fence-plot');
        await key('cancel', 'Escape');
        await shot('cancel-frame');
        await key('undo-plot', 'z');
        await shot('undo-frame');
        await key('reselect-fence', 'f');
        await emit({ type: 'button', label: 'toggle-remove', name: 'remove' });
        await pointer('hover', 'target-fence', -4, 5);
        await pointer('touch', 'remove-fence', -4, 5);
        await shot('remove-frame');
        await key('cancel-after-remove', 'Escape');
        await frames('placement-settled', 2, 100);
      } else if (scenario.name === 'environment-cycle') {
        await frames('held', 1, 1000);
        await setter('invalid-speed', 'setDayNightCycleSeconds', 0);
        await setter('invalid-phase', 'setDayNightPhase', 'midnight');
        await frames('still-held', 1, 1000);
        await setter('release-hold', 'setDayNightCycleSeconds', 72);
        await frames('64-step-cycle', 64, 1125);
        await setter('set-day', 'setDayNightPhase', 'daytime');
        await setter('set-rain', 'setWeather', 'rain');
        await frames('half-rain', 1, 875);
        await shot('weather-half-rain');
        await setter('crossfade-cloud', 'setWeather', 'cloudy');
        await frames('crossfade', 1, 437.5);
        await shot('weather-crossfade');
        await setter('reverse-rain', 'setWeather', 'rain');
        await frames('reverse-zero', 1, 0);
        await frames('full-rain', 1, 1750);
        await shot('weather-full-rain');
        await setter('rain-to-cloud', 'setWeather', 'cloudy');
        await frames('cloud-half', 1, 875);
        await shot('weather-half-cloud');
        await frames('full-cloud', 1, 875);
        await shot('weather-full-cloud');
        await setter('invalid-weather', 'setWeather', 'storm');
        await setter('clear', 'setWeather', 'clear');
        await frames('clear-restored', 1, 1750);
        await shot('weather-clear');
        await setter('set-night', 'setDayNightPhase', 'night');
        await setter('night-rain', 'setWeather', 'rain');
        await frames('night-rain-full', 1, 1750);
        await shot('weather-night-rain');
      } else {
        await frames('url-half-transition', 1, 875);
        await frames('url-full-transition', 1, 875);
        if (scenario.name.startsWith('url-')) await shot(scenario.name);
      }
    }
    assert.deepEqual(fixture.errors, []);
    return { script, trace: canonical(trace), frames: captures, bodylessFrames: bodylessCaptures,
      rainlessFrames: rainlessCaptures, bothHiddenFrames: bothHiddenCaptures, bodyShape };
  } finally {
    await fixture.context.close();
  }
}

async function pixelDiff(page, frames) {
  return page.evaluate(async (frames) => {
    async function decode(data) {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      return image;
    }
    const names = Object.keys(frames);
    const images = await Promise.all(names.map((name) => decode(frames[name])));
    const [a] = images;
    if (images.some((image) => image.width !== a.width || image.height !== a.height)) throw new Error('Frame dimensions differ');
    const canvas = document.createElement('canvas');
    canvas.width = a.width;
    canvas.height = a.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = Object.fromEntries(images.map((image, index) => {
      context.clearRect(0, 0, a.width, a.height);
      context.drawImage(image, 0, 0);
      return [names[index], context.getImageData(0, 0, a.width, a.height).data];
    }));
    const { reference, candidate, referenceBodyless, candidateBodyless,
      referenceRainless, candidateRainless, referenceBothHidden, candidateBothHidden } = pixels;
    const diff = context.createImageData(a.width, a.height);
    const bodyMask = context.createImageData(a.width, a.height);
    const rainMask = context.createImageData(a.width, a.height);
    let changedPixels = 0;
    let outsideAllowedPixels = 0;
    let hiddenChangedPixels = 0;
    let rainlessChangedPixels = 0;
    const differs = (x, y, i) => x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3];
    for (let i = 0; i < reference.length; i += 4) {
      const changed = differs(reference, candidate, i);
      const body = differs(reference, referenceBodyless, i) || differs(candidate, candidateBodyless, i);
      const rain = Boolean(referenceRainless) && (differs(reference, referenceRainless, i) ||
        differs(candidate, candidateRainless, i) || differs(referenceBodyless, referenceBothHidden, i) ||
        differs(candidateBodyless, candidateBothHidden, i));
      if (changed) { changedPixels++; diff.data[i] = 255; diff.data[i + 2] = 255; }
      if (changed && !body && !rain) outsideAllowedPixels++;
      if (differs(referenceBothHidden || referenceBodyless, candidateBothHidden || candidateBodyless, i)) hiddenChangedPixels++;
      if (referenceRainless && differs(referenceRainless, candidateRainless, i)) rainlessChangedPixels++;
      if (body) bodyMask.data[i] = bodyMask.data[i + 1] = bodyMask.data[i + 2] = 255;
      if (rain) rainMask.data[i] = rainMask.data[i + 1] = rainMask.data[i + 2] = 255;
      diff.data[i + 3] = 255;
      bodyMask.data[i + 3] = 255;
      rainMask.data[i + 3] = 255;
    }
    context.putImageData(diff, 0, 0);
    const png = canvas.toDataURL('image/png').split(',')[1];
    context.putImageData(bodyMask, 0, 0);
    const bodyPng = canvas.toDataURL('image/png').split(',')[1];
    context.putImageData(rainMask, 0, 0);
    return { changedPixels, outsideAllowedPixels, hiddenChangedPixels, rainlessChangedPixels, png, bodyPng,
      rainPng: canvas.toDataURL('image/png').split(',')[1] };
  }, Object.fromEntries(Object.entries(frames).map(([name, bytes]) => [name, bytes.toString('base64')])));
}

function assertReferenceCoverage(reference) {
  const at = (scenario, label) => reference[scenario].trace.find((entry) => entry.label === label)?.samples.at(-1);
  assert.deepEqual(at('placement', 'placement-cancels-walk').character.position, [0, 2.4, 0]);
  assert.match(at('placement', 'valid-fence').placement.status, /Ready to place/);
  assert.equal(at('placement', 'rotated-fence').placement.ghost.rotation, Math.PI / 2);
  assert.match(at('placement', 'blocked-player').placement.status, /Move away/);
  for (const label of ['blocked-deck', 'blocked-water', 'blocked-cottage']) {
    assert.match(at('placement', label).placement.status, /Blocked by a farm object/, label);
  }
  assert.equal(at('placement', 'placed-fence').placement.placed.length, 1);
  assert.equal(at('placement', 'touch-preview-plot').placement.placed.length, 1);
  assert.equal(at('placement', 'touch-confirm-plot').placement.placed.length, 2);
  assert.equal(at('placement', 'undo-plot').placement.placed.length, 1);
  assert.equal(at('placement', 'remove-fence').placement.placed.length, 0);
  assert.equal(reference['environment-cycle'].trace.find((entry) => entry.label === '64-step-cycle').samples.length, 64);
  assert.equal(at('environment-cycle', 'held').environment.phase, 'sunset');
  assert.equal(at('environment-cycle', 'still-held').environment.phase, 'sunset');
  assert.deepEqual(at('environment-cycle', 'half-rain').environment.weather, { mode: 'rain', rainAmount: 0.5, cloudyAmount: 0 });
  assert.deepEqual(at('environment-cycle', 'cloud-half').environment.weather, { mode: 'cloudy', rainAmount: 0.5, cloudyAmount: 0.5 });
  assert.deepEqual(at('environment-cycle', 'clear-restored').environment.weather, { mode: 'clear', rainAmount: 0, cloudyAmount: 0 });
  for (const phase of phases) for (const mode of modes) {
    const state = at(`url-${phase}-${mode}`, 'url-full-transition').environment;
    assert.equal(state.phase, phase);
    assert.deepEqual(state.weather, { mode, rainAmount: Number(mode === 'rain'), cloudyAmount: Number(mode === 'cloudy') });
  }
}

// EBR-88 intentionally changed only the rain presentation/particle stream. The
// historical replay still checks every gameplay, clock, weather and lighting
// value; the new-main replay below checks these rain fields without exclusions.
function historicalBehavior(trace) {
  const copy = structuredClone(trace);
  for (const entry of copy) for (const sample of entry.samples) {
    delete sample.environment.randomCalls;
    sample.environment.rain = { visible: sample.environment.rain.visible };
  }
  return copy;
}

/** Record a clean main worktree first, then replay identical events and timestamps. */
export async function comparePlacementEnvironmentReplay({ baselineRoot, candidateRoot, baselineSha, baselineIsArchive = false, evidenceDir }) {
  const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  assert.ok([historicalSha, mergedMainSha].includes(baselineSha), 'Unknown replay reference');
  const historical = baselineSha === historicalSha;
  if (baselineIsArchive) {
    assert.equal(git(candidateRoot, 'rev-parse', `${baselineSha}^{commit}`), baselineSha);
  } else {
    assert.equal(git(baselineRoot, 'rev-parse', 'HEAD'), baselineSha);
    assert.equal(git(baselineRoot, 'status', '--porcelain', '--untracked-files=no', '--', 'src', 'index.html', 'package.json', 'package-lock.json'), '',
      'The reference must be a clean main worktree');
  }
  const scenarios = [
    { name: 'placement', search: '?phase=daytime&weather=clear' },
    { name: 'environment-cycle', search: '?phase=sunset&weather=clear' },
    ...phases.flatMap((phase) => modes.map((mode) => ({ name: `url-${phase}-${mode}`, search: `?phase=${phase}&weather=${mode}` }))),
    { name: 'invalid-url', search: '?phase=midnight&weather=storm' },
  ];
  let baseline;
  let candidate;
  let browser;
  try {
    baseline = await serverAt(baselineRoot);
    browser = await chromium.launch({ headless: true,
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
    const reference = {};
    const referenceFrames = {};
    const referenceBodyless = {};
    const referenceRainless = {};
    const referenceBothHidden = {};
    for (const scenario of scenarios) {
      const { frames, bodylessFrames, rainlessFrames, bothHiddenFrames, ...result } =
        await recordScenario(browser, baseline.url, scenario, undefined, historical);
      reference[scenario.name] = result;
      referenceFrames[scenario.name] = frames;
      referenceBodyless[scenario.name] = bodylessFrames;
      referenceRainless[scenario.name] = rainlessFrames;
      referenceBothHidden[scenario.name] = bothHiddenFrames;
    }
    assertReferenceCoverage(reference);
    let traceDir;
    try {
      traceDir = await mkdtemp('/tmp/opencode/ebr75-reference-');
    } catch (error) {
      if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
      traceDir = await mkdtemp(join(tmpdir(), 'ebr75-reference-'));
    }
    const tracePath = join(traceDir, 'trace.json');
    await writeFile(tracePath, `${JSON.stringify({ baselineSha, browser: browser.version(), viewport, seed, scenarios: reference })}\n`);
    const saved = JSON.parse(await readFile(tracePath, 'utf8'));
    await baseline.server.close();
    baseline = undefined;
    candidate = await serverAt(candidateRoot);
    const results = {};
    const mismatches = [];
    const visualResults = {};
    const visualIsolation = {};
    const expectedRainChanges = [];
    const intendedBodyChanges = [];
    const unexpectedVisualChanges = [];
    const rawTraceDifferences = [];
    const diffPage = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    for (const scenario of scenarios) {
      const actual = await recordScenario(browser, candidate.url, scenario, saved.scenarios[scenario.name].script, historical);
      const expected = saved.scenarios[scenario.name].trace;
      for (let i = 0; i < actual.trace.length; i++) {
        if (!isDeepStrictEqual(actual.trace[i], expected[i])) rawTraceDifferences.push(`${scenario.name}:${actual.trace[i].label}`);
      }
      const comparedActual = historical ? historicalBehavior(actual.trace) : actual.trace;
      const comparedExpected = historical ? historicalBehavior(expected) : expected;
      const index = comparedActual.findIndex((entry, i) => !isDeepStrictEqual(entry, comparedExpected[i]));
      const identical = index === -1 && actual.trace.length === expected.length;
      if (!identical) mismatches.push({ scenario: scenario.name, action: index, expected: comparedExpected[index], actual: comparedActual[index],
        expectedActions: expected.length, actualActions: actual.trace.length });
      const shape = canonical(actual.bodyShape);
      const referenceShape = saved.scenarios[scenario.name].bodyShape;
      if (!isDeepStrictEqual(shape, referenceShape)) {
        mismatches.push({ scenario: scenario.name, body: 'geometry, material or shade shader differs',
          fields: Object.keys(shape).filter((key) => !isDeepStrictEqual(shape[key], referenceShape[key])) });
      }
      results[scenario.name] = { actions: actual.trace.length,
        samples: actual.trace.reduce((sum, entry) => sum + entry.samples.length, 0), identical };
      for (const [name, bytes] of Object.entries(actual.frames)) {
        const original = referenceFrames[scenario.name][name];
        assert.ok(original, `Missing reference frame: ${name}`);
        const captured = expected.find((entry) => entry.label === name)?.samples[0];
        assert.ok(captured, `Missing reference snapshot: ${name}`);
        const frames = { reference: original, candidate: bytes,
          referenceBodyless: referenceBodyless[scenario.name][name], candidateBodyless: actual.bodylessFrames[name] };
        if (historical && captured.environment.weather.rainAmount > 0) {
          frames.referenceRainless = referenceRainless[scenario.name][name];
          frames.candidateRainless = actual.rainlessFrames[name];
          frames.referenceBothHidden = referenceBothHidden[scenario.name][name];
          frames.candidateBothHidden = actual.bothHiddenFrames[name];
        }
        assert.ok(Object.values(frames).every(Boolean), `Missing isolated render: ${name}`);
        const diff = await pixelDiff(diffPage, frames);
        // The signed look explicitly protects the morning, sunset and night
        // anchors. Do not allow even body-only changes in those stills.
        const protectedAnchor = /^url-(morning|sunset|night)-/.test(name) || name === 'weather-night-rain';
        const protectedChangedPixels = protectedAnchor ? (frames.referenceRainless ? diff.rainlessChangedPixels : diff.changedPixels) : 0;
        visualResults[name] = diff.changedPixels;
        visualIsolation[name] = { outsideAllowedPixels: diff.outsideAllowedPixels, hiddenChangedPixels: diff.hiddenChangedPixels,
          protectedChangedPixels };
        if (diff.changedPixels && historical && captured.environment.weather.rainAmount > 0) expectedRainChanges.push(name);
        else if (diff.changedPixels) intendedBodyChanges.push(name);
        if (diff.outsideAllowedPixels || diff.hiddenChangedPixels || protectedChangedPixels) unexpectedVisualChanges.push(name);
        if (evidenceDir) {
          for (const dir of ['baseline', 'candidate', 'diff', 'body-mask', 'rain-mask']) await mkdir(join(evidenceDir, dir), { recursive: true });
          await writeFile(join(evidenceDir, 'baseline', `${name}.png`), original);
          await writeFile(join(evidenceDir, 'candidate', `${name}.png`), bytes);
          await writeFile(join(evidenceDir, 'diff', `${name}.png`), Buffer.from(diff.png, 'base64'));
          await writeFile(join(evidenceDir, 'body-mask', `${name}.png`), Buffer.from(diff.bodyPng, 'base64'));
          await writeFile(join(evidenceDir, 'rain-mask', `${name}.png`), Buffer.from(diff.rainPng, 'base64'));
        }
      }
    }
    await diffPage.close();
    const report = { baselineSha, candidateSha: git(candidateRoot, 'rev-parse', 'HEAD'),
      sourceStatus: git(candidateRoot, 'status', '--porcelain', '--untracked-files=all', '--', 'src', 'index.html',
        'package.json', 'package-lock.json', 'tools/placement-environment-replay.mjs', 'tests/browser/placement-environment-replay.browser.mjs'),
      browser: browser.version(), renderer: 'SwiftShader', viewport, deviceScaleFactor: 1, seed,
      referenceTrace: tracePath, referenceSha256: createHash('sha256').update(JSON.stringify(saved)).digest('hex'),
      excludedHistoricalFields: historical ? ['environment.rain except visible', 'environment.randomCalls'] : [],
      results, rawTraceDifferences, visualResults, visualIsolation, intendedBodyChanges, expectedRainChanges, unexpectedVisualChanges, mismatches };
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await writeFile(join(evidenceDir, 'replay.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
    assert.deepEqual(mismatches, [], 'Placement/environment replay differs from clean main');
    assert.deepEqual(unexpectedVisualChanges, [], 'Placement/environment frames differ outside the isolated body and historical rain');
    return report;
  } finally {
    await browser?.close();
    await baseline?.server.close();
    await candidate?.server.close();
  }
}
