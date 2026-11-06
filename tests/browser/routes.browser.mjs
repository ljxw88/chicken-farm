import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const evidenceDir = process.env.EBR87_EVIDENCE_DIR;
let url = process.env.EBR87_URL;
let server, browser;
before(async () => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  if (!url) {
    server = await createServer({ configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, hmr: false } });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    url = `http://127.0.0.1:${address.port}`;
  }
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    let seed = 0xeb870001, id = 0;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__routeTime = 0;
    window.__routeTrace = [];
    window.__routeStep = (time) => {
      window.__routeTime = time;
      const current = [...callbacks.values()];
      callbacks.clear();
      for (const callback of current) callback(time);
      if (window.__ebr87) {
        const p = window.__ebr87.character.position;
        window.__routeTrace.push([p.x, p.y, p.z]);
      }
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr87 = { scene, camera, character, stairs, obstacles, controls, ground, bridgeHeight, clickTargets, engine };\n` });
  });
  await page.goto(`${url}/?phase=daytime&weather=clear`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.__routeStep(0));
  return { context, page, errors };
}

async function pointAt(page, x, y, z) {
  return page.evaluate(({ x, y, z }) => {
    const { camera, character } = window.__ebr87;
    camera.updateMatrixWorld();
    const p = character.position.clone().set(x, y, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }, { x, y, z });
}

async function click(page, point) {
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  await page.mouse.click(point.x, point.y);
}

async function advance(page, count, stopAtBridge = false) {
  return page.evaluate(({ count, stopAtBridge }) => {
    const { controls, character, bridgeHeight } = window.__ebr87;
    for (let i = 0; i < count && controls.entity.character.target; i++) {
      window.__routeStep(window.__routeTime + 100);
      const p = character.position;
      if (stopAtBridge && Math.abs((bridgeHeight(p.x, p.z) ?? 0) - 2.52) < 1e-5) return 'bridge';
    }
    return controls.entity.character.target ? 'moving' : 'idle';
  }, { count, stopAtBridge });
}

async function stepFrames(page, count) {
  await page.evaluate((frames) => {
    for (let i = 0; i < frames; i++) window.__routeStep(window.__routeTime + 100);
  }, count);
}

async function frame(context, name) {
  if (!evidenceDir) return;
  const page = context.pages()[0], cdp = await context.newCDPSession(page);
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const bytes = Buffer.from(screenshot.data, 'base64');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1280, 720]);
  await writeFile(join(evidenceDir, `${name}.png`), bytes);
  await cdp.detach();
}

async function data(page) {
  return page.evaluate(() => {
    const { character, stairs, obstacles, controls } = window.__ebr87;
    const boxes = [...stairs.treads, stairs.footPad].map((mesh) => {
      const p = mesh.getWorldPosition(mesh.position.clone());
      const { width, height, depth } = mesh.geometry.parameters;
      return { minX: p.x - width / 2, maxX: p.x + width / 2,
        minY: p.y - height / 2, maxY: p.y + height / 2,
        minZ: p.z - depth / 2, maxZ: p.z + depth / 2 };
    });
    return { position: character.position.toArray(), trace: window.__routeTrace, obstacles, boxes,
      target: controls.entity.character.target, waypoints: controls.entity.character.waypoints };
  });
}

function assertSafe({ trace, obstacles, boxes }) {
  for (const [x, y, z] of trace) {
    assert.ok(y >= 0.16 - 1e-8, `below pad/over void: ${[x, y, z]}`);
    for (const box of boxes) {
      const dx = x - Math.max(box.minX, Math.min(box.maxX, x));
      const dy = y + 0.4 - Math.max(box.minY, Math.min(box.maxY, y + 0.4));
      const dz = z - Math.max(box.minZ, Math.min(box.maxZ, z));
      assert.ok(dx * dx + dy * dy + dz * dz >= 0.4 ** 2 - 1e-6, `clipped a tread at ${[x, y, z]}`);
    }
    for (let i = 0; i < 32; i++) {
      const px = x + 0.4 * Math.cos(i * Math.PI / 16), pz = z + 0.4 * Math.sin(i * Math.PI / 16);
      const island = Math.abs(px) <= 8 + 1e-6 && Math.abs(pz) <= 8 + 1e-6;
      const stone = boxes.some((b) => px >= b.minX - 1e-6 && px <= b.maxX + 1e-6 &&
        pz >= b.minZ - 1e-6 && pz <= b.maxZ + 1e-6);
      assert.ok(island || stone, `footprint over void at ${[x, y, z]}`);
    }
    for (const obstacle of obstacles) {
      if (obstacle.blocksWalking === false) continue;
      const dist = obstacle.kind === 'circle'
        ? Math.hypot(x - obstacle.x, z - obstacle.z) - obstacle.radius
        : Math.hypot(x - Math.max(obstacle.minX, Math.min(obstacle.maxX, x)),
          z - Math.max(obstacle.minZ, Math.min(obstacle.maxZ, z)));
      assert.ok(dist > 0.4 - 1e-6, `${obstacle.name} entered at ${[x, y, z]}`);
    }
  }
}

async function save(name, result) {
  if (evidenceDir) await writeFile(join(evidenceDir, `${name}.json`), `${JSON.stringify(result, null, 2)}\n`);
}

test('one click from spawn reaches the stair pad over the bridge without entering water', { timeout: 120000 }, async (t) => {
  const { page, context, errors } = await open(t);
  await frame(context, '01-spawn');
  const destination = await page.evaluate(() => {
    const { footPad } = window.__ebr87.stairs;
    return [footPad.position.x, footPad.position.y + footPad.geometry.parameters.height / 2, footPad.position.z];
  });
  await click(page, await pointAt(page, ...destination));
  const atEvent = await data(page);
  assert.ok(atEvent.target, 'the route must resolve synchronously on pointerdown');
  assert.equal(await advance(page, 120, true), 'bridge');
  await frame(context, '02-bridge');
  assert.equal(await advance(page, 160), 'idle');
  await frame(context, '03-stair-pad');
  const result = await data(page);
  assert.ok(Math.hypot(result.position[0] - destination[0], result.position[2] - destination[2]) < 0.03,
    `missed the pad: ${result.position}`);
  assert.ok(result.trace.some(([x, y, z]) => x > 2.9 && x < 4.9 && z > -2.65 && z < -1.25 && y > 2.5));
  assertSafe(result);
  assert.deepEqual(errors, []);
  await save('01-stair-pad-trace', { browser: browser.version(), url, destination, atEvent, ...result, errors });
});

test('a reachable stair-mouth click is not clamped to the rectangular island rim', { timeout: 120000 }, async (t) => {
  const { page, context, errors } = await open(t);
  const destination = [7.9, 2.4, 0.75];
  await click(page, await pointAt(page, ...destination));
  assert.ok((await data(page)).target, 'stair-mouth click did nothing');
  assert.equal(await advance(page, 200), 'idle');
  const result = await data(page);
  await frame(context, '07-stair-mouth');
  await save('07-stair-mouth', { browser: browser.version(), url, destination, ...result, errors });
  assert.ok(Math.hypot(result.position[0] - destination[0], result.position[2] - destination[2]) < 0.03,
    `stair-mouth click stopped at ${result.position}`);
  assert.ok(result.trace.some(([x, y]) => x > 2.9 && x < 4.9 && y > 2.5), 'route did not use the bridge');
  assertSafe(result);
  assert.deepEqual(errors, []);

  // A nearby unsupported click should approach the rounded island/stair
  // corner, rather than the more distant rectangular x=7.6 inset.
  const blocked = [7.95, 2.4, 0.4];
  await click(page, await pointAt(page, ...blocked));
  assert.ok((await data(page)).target, 'near-corner click did nothing');
  assert.equal(await advance(page, 120), 'idle');
  const corner = await data(page);
  const ideal = 0.4 - Math.hypot(0.05, 0.25);
  assert.ok(Math.hypot(corner.position[0] - blocked[0], corner.position[2] - blocked[2]) < ideal + 0.002,
    `missed the nearest stair-mouth boundary: ${corner.position}`);
  assertSafe(corner);
  assert.deepEqual(errors, []);
  await frame(context, '08-stair-corner');
  await save('08-stair-corner', { browser: browser.version(), url, blocked, ideal, ...corner, errors });
});

test('the running app follows a single live pad click across the bridge', { timeout: 90000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__ebr87 = { scene, camera, character, stairs, obstacles, controls, ground, bridgeHeight, clickTargets, engine };\n` });
  });
  await page.goto(`${url}/?phase=daytime&weather=clear`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    window.__liveRouteTrace = [];
    function record() {
      window.__liveRouteTrace.push(window.__ebr87.character.position.toArray());
      requestAnimationFrame(record);
    }
    requestAnimationFrame(record);
  });
  const destination = await page.evaluate(() => {
    const p = window.__ebr87.stairs.footPad;
    return [p.position.x, p.position.y + p.geometry.parameters.height / 2, p.position.z];
  });
  await click(page, await pointAt(page, ...destination));
  await page.waitForFunction(() => {
    const p = window.__ebr87.character.position;
    return p.x > 3.2 && p.x < 4.6 && p.y > 2.5;
  }, null, { timeout: 20000 });
  await frame(context, 'live-bridge');
  await page.waitForFunction(([x, , z]) => {
    const { character, controls } = window.__ebr87;
    return !controls.entity.character.target && Math.hypot(character.position.x - x, character.position.z - z) < 0.03;
  }, destination, { timeout: 25000 });
  await frame(context, 'live-stair-pad');
  const result = await page.evaluate(() => {
    const { character, stairs, obstacles } = window.__ebr87;
    const boxes = [...stairs.treads, stairs.footPad].map((mesh) => {
      const p = mesh.getWorldPosition(mesh.position.clone());
      const { width, height, depth } = mesh.geometry.parameters;
      return { minX: p.x - width / 2, maxX: p.x + width / 2,
        minY: p.y - height / 2, maxY: p.y + height / 2,
        minZ: p.z - depth / 2, maxZ: p.z + depth / 2 };
    });
    return { position: character.position.toArray(), obstacles, boxes, trace: window.__liveRouteTrace };
  });
  assertSafe(result);
  assert.deepEqual(errors, []);
  await save('live-stair-pad-trace', { browser: browser.version(), url, destination, ...result, errors });
});

// Independently raycast the visible building, or the ground beneath a
// water click, and estimate the nearest free capsule center with radial samples.
async function selectedPointAndOracle(page, screen, buildingName) {
  return page.evaluate(async ({ screen, buildingName }) => {
    const { Raycaster, Vector2, Vector3, Plane } = await import('/node_modules/three/build/three.module.js');
    const { camera, scene, ground, obstacles } = window.__ebr87;
    const rect = document.querySelector('#scene').getBoundingClientRect();
    const ray = new Raycaster();
    ray.setFromCamera(new Vector2((screen.x - rect.left) / rect.width * 2 - 1,
      -(screen.y - rect.top) / rect.height * 2 + 1), camera);
    const object = buildingName ? scene.getObjectByName(buildingName) : ground;
    const hit = ray.intersectObject(object, true)[0];
    if (buildingName && !hit) throw new Error(`no hit on ${buildingName}`);
    const selected = hit?.point ?? ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -2.4), new Vector3());
    if (!selected) throw new Error('pointer ray missed the ground plane');
    const goal = { x: selected.x, z: selected.z };
    const free = (x, z) => x >= -7.6 && x <= 7.6 && z >= -7.6 && z <= 7.6 && obstacles.every((o) => {
      if (o.blocksWalking === false) return true;
      if (o.kind === 'circle') return Math.hypot(x - o.x, z - o.z) > o.radius + 0.4;
      return Math.hypot(x - Math.max(o.minX, Math.min(o.maxX, x)), z - Math.max(o.minZ, Math.min(o.maxZ, z))) > 0.4;
    });
    let nearest = 0;
    search: for (; nearest <= 5; nearest += 0.02) {
      for (let i = 0; i < 360; i++) {
        const angle = i * Math.PI / 180;
        if (free(goal.x + nearest * Math.cos(angle), goal.z + nearest * Math.sin(angle))) break search;
      }
    }
    return { goal, nearest };
  }, { screen, buildingName });
}

for (const scenario of [
  { name: 'stream', world: [3.1, 2.4, 0.6] },
  { name: 'near-stream', world: [2.1, 2.4, 3.6] },
  { name: 'pond', world: [4, 2.4, -3.5] },
  { name: 'cottage', world: [-3.4, 5.2, -3.2], building: 'farm-cottage' },
  { name: 'coop', world: [0.15, 4.1, -3.2], building: 'farm-ramp-coop-1' },
  { name: 'void', world: [-9, 2.4, 3] },
]) {
  test(`clicking the ${scenario.name} walks to its nearest reachable point`, { timeout: 120000 }, async (t) => {
    const { page, context, errors } = await open(t);
    const screen = await pointAt(page, ...scenario.world);
    const oracle = await selectedPointAndOracle(page, screen, scenario.building);
    assert.ok(oracle.nearest > 0 && oracle.nearest <= 5, `${scenario.name} test must click inside a blocker`);
    await click(page, screen);
    const atEvent = await data(page);
    assert.ok(atEvent.target, `${scenario.name} click did nothing`);
    assert.equal(await advance(page, 240), 'idle');
    const result = await data(page);
    const [x, , z] = result.position;
    assert.ok(Math.hypot(x, z) > 0.05, `${scenario.name} click did not walk`);
    const distance = Math.hypot(x - oracle.goal.x, z - oracle.goal.z);
    assert.ok(distance <= oracle.nearest + 0.06, `${scenario.name}: nearest ${oracle.nearest}, reached ${distance}`);
    if (scenario.name === 'coop') {
      assert.ok(Math.hypot(x - 1.2501, z + 2.8499) < 0.002, `missed the nearest shared coop corner: ${result.position}`);
    }
    assertSafe(result);
    assert.deepEqual(errors, []);
    await frame(context, `04-${scenario.name}-nearest`);
    await save(`04-${scenario.name}-nearest`, { browser: browser.version(), url, screen, oracle, distance, ...result, errors });
  });
}

test('a click on the water from close to the bank still moves to the bank', { timeout: 120000 }, async (t) => {
  const { page, context, errors } = await open(t);
  await click(page, await pointAt(page, 1.7, 2.4, 3.6));
  assert.equal(await advance(page, 120), 'idle');
  const before = await data(page);
  assert.ok(Math.hypot(before.position[0] - 1.7, before.position[2] - 3.6) < 0.01);
  await click(page, await pointAt(page, 2.1, 2.4, 3.6));
  assert.ok((await data(page)).target, 'near-bank water click did nothing');
  assert.equal(await advance(page, 120), 'idle');
  const result = await data(page);
  assert.ok(Math.hypot(result.position[0] - before.position[0], result.position[2] - before.position[2]) > 0.1);
  assert.ok(Math.hypot(result.position[0] - 1.832, result.position[2] - 3.6) < 0.02, `missed the nearest bank: ${result.position}`);
  assertSafe(result);
  assert.deepEqual(errors, []);
  await frame(context, '04-near-bank-reclick');
  await save('04-near-bank-reclick', { browser: browser.version(), url, before, ...result, errors });
});

test('any key cancels a route, and an active placement tool keeps pointer priority', { timeout: 120000 }, async (t) => {
  const { page, context, errors } = await open(t);
  const pad = await page.evaluate(() => {
    const p = window.__ebr87.stairs.footPad;
    return [p.position.x, p.position.y + p.geometry.parameters.height / 2, p.position.z];
  });
  await click(page, await pointAt(page, ...pad));
  await advance(page, 8);
  await page.keyboard.press('q');
  const cancelled = await data(page);
  assert.equal(cancelled.target, null);
  await stepFrames(page, 30);
  assert.deepEqual((await data(page)).position, cancelled.position);

  await click(page, await pointAt(page, ...pad));
  await advance(page, 4);
  const beforeKey = await data(page);
  await page.keyboard.down('w');
  await page.evaluate(() => window.__routeStep(window.__routeTime + 100));
  await page.keyboard.up('w');
  const overridden = await data(page);
  assert.equal(overridden.target, null);
  assert.notDeepEqual(overridden.position, beforeKey.position, 'W must still walk normally');
  await stepFrames(page, 30);
  assert.deepEqual((await data(page)).position, overridden.position);
  await frame(context, '05-keyboard-override');

  await click(page, await pointAt(page, ...pad));
  assert.ok((await data(page)).target);
  await page.keyboard.press('f');
  const before = await data(page);
  assert.equal(before.target, null, 'opening a placement tool must cancel the route');
  const site = await pointAt(page, -4, 2.4, 5);
  await page.mouse.move(site.x, site.y);
  await click(page, site);
  assert.equal(await page.evaluate(() => window.__ebr87.scene.getObjectsByProperty('name', 'placed-fence').length), 1);
  await stepFrames(page, 30);
  assert.deepEqual((await data(page)).position, before.position);
  assert.deepEqual(errors, []);
  await frame(context, '06-placement-priority');
  await save('05-keyboard-placement', { browser: browser.version(), url, cancelled, overridden, errors });
});

test('a newly placed ECS fence is avoided by the next click route', { timeout: 120000 }, async (t) => {
  const { page, context, errors } = await open(t);
  await page.keyboard.press('f');
  const site = await pointAt(page, -3.75, 2.4, 3.75);
  await page.mouse.move(site.x, site.y);
  await click(page, site);
  await page.keyboard.press('Escape');
  const placed = await page.evaluate(() => ({
    entities: [...window.__ebr87.engine.world.with('placed', 'obstacle')].map((item) => item.obstacle),
    mirrored: window.__ebr87.obstacles.filter((item) => item.name.startsWith('placed-fence-')),
  }));
  assert.equal(placed.entities.length, 1);
  assert.deepEqual(placed.mirrored, placed.entities);
  const goal = [-3.75, 2.4, 5.0];
  await click(page, await pointAt(page, ...goal));
  assert.ok((await data(page)).target, 'the click must route immediately after placement');
  assert.equal(await advance(page, 240), 'idle');
  const result = await data(page);
  assert.ok(Math.hypot(result.position[0] - goal[0], result.position[2] - goal[2]) < 0.03,
    `did not reach the other side of the fence: ${result.position}`);
  assertSafe(result);
  assert.deepEqual(errors, []);
  await frame(context, '09-placed-fence-route');
  await save('09-placed-fence-route', { browser: browser.version(), url, goal, placed, ...result, errors });
});
