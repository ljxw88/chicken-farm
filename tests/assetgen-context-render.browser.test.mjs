import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { root } from '../tools/assetgen/config.mjs';
import { createVisualRunner } from '../tools/assetgen/visual.mjs';

test('the actual verifier composite puts the barrel on clear ground beside the references', { timeout: 90000 }, async () => {
  const fixture = JSON.parse(await readFile(join(root, 'tests/fixtures/assetgen/qa2-barrel.fixture.json'), 'utf8'));
  const runner = await createVisualRunner();
  const page = await runner.browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript((recipe) => { window.__assetForgeFixture = recipe; }, fixture.recipe);
    await page.goto(`http://127.0.0.1:${runner.server.httpServer.address().port}/tools/assetgen/render.html?id=${fixture.spec.id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__assetForge, null, { timeout: 45000 });
    await page.evaluate(() => window.__assetForge.setView(45, 'daytime', 'grass', true));
    const state = await page.evaluate(() => window.__assetForge.state());
    assert.equal(state.contextPlacement.x, -2);
    assert.equal(state.contextPlacement.z, 4.2);
    assert.equal(state.pixel.canvasWidth, 320);
    assert.equal(state.pixel.canvasHeight, 180);
    const composite = await page.screenshot();
    await page.evaluate(() => window.__assetForge.setView(45, 'daytime', 'grass', false));
    assert.notDeepEqual(composite, await page.screenshot());
    assert.deepEqual(errors, []);
  } finally { await page.close(); await runner.close(); }
});
