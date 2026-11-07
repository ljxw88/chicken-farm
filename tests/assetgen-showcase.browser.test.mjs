import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVisualRunner } from '../tools/assetgen/visual.mjs';

test('review island uses the real pixel pass and switches orbit and lighting', { timeout: 90000 }, async () => {
  const runner = await createVisualRunner();
  const page = await runner.browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const recipe = { id: 'review-fixture', category: 'prop', footprint: { w: 0.8, d: 0.8 }, height: 0.8, origin: 'base-center', facing: '+Z',
    parts: [{ name: 'body', prim: 'box', size: [0.8, 0.8, 0.8], at: [0, 0.4, 0], mat: 'wood.mid' }],
    anchors: {}, emissive: [], collision: { type: 'box', w: 0.8, d: 0.8, h: 0.8 }, slots: {}, tags: [] };
  try {
    await page.addInitScript((fixture) => { window.__assetShowcaseItems = [{ recipe: fixture, x: 2, z: 6 }]; }, recipe);
    await page.goto(`http://127.0.0.1:${runner.server.httpServer.address().port}/tools/assetgen/showcase-render.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__assetShowcase, null, { timeout: 45000 });
    const state = await page.evaluate(() => ({ count: window.__assetShowcase.count, pixel: window.__assetShowcase.pixel() }));
    assert.equal(state.count, 1);
    assert.equal(state.pixel.enabled, true);
    assert.equal(state.pixel.canvasWidth, 320);
    assert.equal(state.pixel.canvasHeight, 180);
    await page.evaluate(() => window.__assetShowcase.setView(45, 'daytime'));
    const day = await page.screenshot();
    await page.evaluate(() => window.__assetShowcase.setView(90, 'night'));
    const night = await page.screenshot();
    assert.notDeepEqual(day, night);
    assert.deepEqual(errors, []);
  } finally { await page.close(); await runner.close(); }
});
