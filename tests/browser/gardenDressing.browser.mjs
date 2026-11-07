import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const evidence = process.env.EBR49A_EVIDENCE_DIR;
let url = process.env.EBR49A_URL;
let server, browser;

before(async () => {
  if (evidence) await mkdir(evidence, { recursive: true });
  if (!url) {
    const host = process.env.EBR49A_HOST || '127.0.0.1';
    const port = Number(process.env.EBR49A_PORT || 0);
    server = await createServer({ configFile: false, logLevel: 'error', server: { host, port, strictPort: Boolean(port), hmr: false } });
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    url = `http://${host}:${address.port}`;
  }
  browser = await chromium.launch({ headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
});

after(async () => { await browser?.close(); await server?.close(); });

async function open(t) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
  });
  // Only the test owns the frame clock; all movement and placement is real input.
  await page.addInitScript(() => {
    let id = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = (handle) => callbacks.delete(handle);
    window.__gardenTime = 0;
    window.__gardenStep = (time) => {
      window.__gardenTime = time;
      const current = [...callbacks.values()];
      callbacks.clear();
      for (const callback of current) callback(time);
    };
  });
  await page.route('**/src/main.ts*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\nwindow.__gardenTest = typeof context !== 'undefined' ? context : { scene, camera, character, obstacles, controls, engine };\n` });
  });
  await page.goto(`${url}/?phase=daytime&weather=clear&seed=123&skyhud=0`, { waitUntil: 'networkidle' });
  assert.ok(await page.evaluate(() => Boolean(window.__gardenTest)));
  await page.evaluate(() => window.__gardenStep(0));
  return { page, errors };
}

async function pointAt(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const { camera, character } = window.__gardenTest;
    camera.updateMatrixWorld();
    const p = character.position.clone().set(x, 2.4, z).project(camera);
    const rect = document.querySelector('#scene').getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }, { x, z });
}

async function pointCanvas(page, x, z) {
  const point = await pointAt(page, x, z);
  assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'scene');
  return point;
}

async function clickWalk(page, x, z) {
  const point = await pointCanvas(page, x, z);
  await page.mouse.click(point.x, point.y);
  assert.ok(await page.evaluate(() => window.__gardenTest.controls.entity.character.target), 'click must start a real route');
  const result = await page.evaluate(() => {
    const trace = [];
    for (let frame = 0; frame < 240 && window.__gardenTest.controls.entity.character.target; frame++) {
      window.__gardenStep(window.__gardenTime + 100);
      trace.push(window.__gardenTest.character.position.toArray());
    }
    return { position: window.__gardenTest.character.position.toArray(),
      target: window.__gardenTest.controls.entity.character.target, trace };
  });
  assert.equal(result.target, null, 'route failed to finish');
  return result;
}

async function walkKeys(page, keys, frames) {
  for (const key of keys) await page.keyboard.down(key);
  const trace = await page.evaluate((frames) => {
    const positions = [];
    for (let frame = 0; frame < frames; frame++) {
      window.__gardenStep(window.__gardenTime + 100);
      positions.push(window.__gardenTest.character.position.toArray());
    }
    return positions;
  }, frames);
  for (const key of keys) await page.keyboard.up(key);
  return trace;
}

async function capture(page, name) {
  if (!evidence) return;
  const cdp = await page.context().newCDPSession(page);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(evidence, name), Buffer.from(shot.data, 'base64'));
  await cdp.detach();
}

test('real walking is stopped by a hive and can retreat without a collision trap', { timeout: 90000 }, async (t) => {
  const { page, errors } = await open(t);
  const initial = await page.evaluate(() => {
    const { engine, obstacles } = window.__gardenTest;
    const hives = obstacles.filter((obstacle) => obstacle.name.startsWith('beehive-'));
    return { hives, mirroredOnce: hives.every((hive) => [...engine.world.with('obstacle')].filter((item) => item.obstacle === hive).length === 1) };
  });
  assert.equal(initial.hives.length, 2);
  assert.equal(initial.mirroredOnce, true);

  const approach = await clickWalk(page, -6.7, -2);
  assert.ok(Math.hypot(approach.position[0] + 6.7, approach.position[2] + 2) < 0.03, `approach ${approach.position}`);
  const trace = await walkKeys(page, ['w', 'd'], 20); // World -Z, toward hive 1.
  const blocked = trace.at(-1);
  const hive = initial.hives[0];
  assert.ok(Math.abs(blocked[0] + 6.7) < 0.03);
  assert.ok(blocked[2] >= hive.maxZ + 0.4 - 1e-6 && blocked[2] < hive.maxZ + 0.41,
    `hive did not stop the capsule at its face: ${blocked}`);
  for (const [x, , z] of trace) {
    const dx = x - Math.max(hive.minX, Math.min(hive.maxX, x));
    const dz = z - Math.max(hive.minZ, Math.min(hive.maxZ, z));
    assert.ok(Math.hypot(dx, dz) >= 0.4 - 1e-6, `clipped hive at ${x},${z}`);
  }
  await capture(page, '01-hive-block.png');
  const retreat = (await walkKeys(page, ['s', 'a'], 8)).at(-1);
  assert.ok(retreat[2] > blocked[2] + 1, `hive trapped the player: ${retreat}`);
  assert.deepEqual(errors, []);
  if (evidence) await writeFile(join(evidence, 'hive-walk.json'), `${JSON.stringify({ approach, blocked, retreat, trace }, null, 2)}\n`);
});

test('the island-side corridor stays walkable past both hives', { timeout: 90000 }, async (t) => {
  const { page, errors } = await open(t);
  const approach = await clickWalk(page, -7.5, -2);
  assert.ok(Math.hypot(approach.position[0] + 7.5, approach.position[2] + 2) < 0.03, `corridor approach ${approach.position}`);
  const trace = await walkKeys(page, ['w', 'd'], 11); // World -Z, between hives and the rim.
  assert.ok(trace.some(([x, , z]) => x < -7.45 && z < -3.5 && z > -4.3), 'did not pass alongside the hives');
  assert.ok(trace.at(-1)[2] < -5.3, `hives blocked the rim corridor: ${trace.at(-1)}`);
  assert.ok(trace.every(([x]) => x >= -7.6 - 1e-6 && x < -7.45));
  await capture(page, '01b-hive-rim-corridor.png');
  assert.deepEqual(errors, []);
  if (evidence) await writeFile(join(evidence, 'hive-corridor.json'), `${JSON.stringify({ approach, trace }, null, 2)}\n`);
});

test('real walking crosses a flower patch with no collision or placement reservation', { timeout: 90000 }, async (t) => {
  const { page, errors } = await open(t);
  const approach = await clickWalk(page, -1.2, 3);
  assert.ok(Math.hypot(approach.position[0] + 1.2, approach.position[2] - 3) < 0.03);
  const trace = await walkKeys(page, ['s', 'a'], 8); // World +Z through the red patch at (-1.2, 4.1).
  assert.ok(trace.some(([x, , z]) => Math.abs(x + 1.2) < 0.05 && Math.abs(z - 4.1) < 0.2), 'never entered the flower patch');
  assert.ok(trace.at(-1)[2] > 5.3, `flowers blocked walking: ${trace.at(-1)}`);
  assert.equal(await page.evaluate(() => {
    const { world } = window.__gardenTest.engine;
    return [...world.with('obstacle')].some((item) => /flower/.test(item.obstacle.name)) ||
      [...world.with('placementBlocker')].some((item) => /flower/.test(item.placementBlocker.name));
  }), false);
  await capture(page, '02-flower-crossing.png');
  assert.deepEqual(errors, []);
  if (evidence) await writeFile(join(evidence, 'flower-walk.json'), `${JSON.stringify({ approach, trace }, null, 2)}\n`);
});

test('plot ghost retains olive/rust washes, real half-opacity parts and hive rejection', { timeout: 90000 }, async (t) => {
  const { page, errors } = await open(t);
  await page.keyboard.press('p');
  const validPoint = await pointCanvas(page, -1.2, 4.1); // The red flowers themselves reserve nothing.
  await page.mouse.move(validPoint.x, validPoint.y);
  assert.match(await page.locator('.placement-status').textContent(), /Ready to place/);
  const inspect = () => page.evaluate(() => {
    const { scene, engine } = window.__gardenTest;
    const wash = scene.getObjectByName('placement-wash');
    const ghost = scene.getObjectByName('placement-ghost');
    const state = [...engine.world.with('placement')][0].placement;
    return { valid: state.valid, area: state.area, visible: ghost.visible,
      wash: { color: wash.material.color.getHex(), opacity: wash.material.opacity, size: [wash.scale.x, wash.scale.y] },
      parts: ghost.children.map((part) => ({ name: part.name, color: part.material.color.getHex(),
        opacity: part.material.opacity, transparent: part.material.transparent })) };
  });
  const valid = await inspect();
  assert.equal(valid.visible, true);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.wash, { color: 0x283724, opacity: 0.5, size: [3, 1.5] });
  assert.ok(valid.area.minX < -1.2 && valid.area.maxX > -1.2 && valid.area.minZ < 4.1 && valid.area.maxZ > 4.1);
  assert.equal(valid.parts.filter((part) => part.name === 'garden-plot-seedling').length, 8);
  assert.ok(valid.parts.every((part) => part.opacity === 0.5 && part.transparent));
  assert.equal(valid.parts.find((part) => part.name === 'garden-plot-soil').color, 0x5f4630);
  await page.evaluate(() => window.__gardenStep(window.__gardenTime + 100));
  await capture(page, '03-plot-ghost-valid.png');

  await page.keyboard.press('r');
  const invalidPoint = await pointCanvas(page, -6.7, -3.5);
  await page.mouse.move(invalidPoint.x, invalidPoint.y);
  assert.match(await page.locator('.placement-status').textContent(), /Blocked by a farm object/);
  const invalid = await inspect();
  assert.equal(invalid.valid, false);
  assert.deepEqual(invalid.wash, { color: 0xc45a3a, opacity: 0.5, size: [1.5, 3] });
  assert.deepEqual(invalid.parts, valid.parts, 'invalid wash must not tint the actual plot parts');
  const overlapping = await page.evaluate(() => {
    const { engine, obstacles } = window.__gardenTest;
    const area = [...engine.world.with('placement')][0].placement.area;
    return obstacles.filter((o) => o.kind === 'box' && area.minX < o.maxX && area.maxX > o.minX &&
      area.minZ < o.maxZ && area.maxZ > o.minZ).map((o) => o.name);
  });
  assert.ok(overlapping.includes('beehive-1'));
  assert.equal(overlapping.includes('cottage'), false, 'hive rejection must not be masked by the cottage collider');
  assert.equal(await page.locator('[data-confirm]').isDisabled(), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.__gardenTest.scene.getObjectsByProperty('name', 'placed-plot').length), 0);
  await page.evaluate(() => window.__gardenStep(window.__gardenTime + 100));
  await capture(page, '04-plot-ghost-hive-invalid.png');
  assert.deepEqual(errors, []);
  if (evidence) await writeFile(join(evidence, 'plot-ghost.json'), `${JSON.stringify({ valid, invalid, overlapping }, null, 2)}\n`);
});
