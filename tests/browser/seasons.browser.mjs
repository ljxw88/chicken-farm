import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { assertOnlyCrownMaterials, browserArgs, captureCrownSilhouette, compareFrames, inspectFrame, openFrame,
  scenarios, screenshot, serve } from '../../tools/ebr52-capture.mjs';

let server, browser, url;
before(async () => {
  url = process.env.EBR52_URL;
  if (!url) {
    const listening = await serve();
    server = listening.server;
    url = listening.url;
  }
  browser = await chromium.launch({ headless: true, args: browserArgs });
});
after(async () => { await browser?.close(); await server?.close(); });

async function inspectArtifacts(page, { diffPng, maskPng }) {
  return page.evaluate(async ({ diffPng, maskPng }) => {
    async function pixels(data) {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    }
    const [diff, mask] = await Promise.all([pixels(diffPng), pixels(maskPng)]);
    let colored = 0, outside = 0, visibleMask = 0, nonOpaque = 0;
    for (let i = 0; i < diff.length; i += 4) {
      if (diff[i] || diff[i + 1] || diff[i + 2]) colored++;
      if (diff[i] === 255 && diff[i + 1] === 0 && diff[i + 2] === 255) outside++;
      if (mask[i] || mask[i + 1] || mask[i + 2]) visibleMask++;
      if (diff[i + 3] !== 255 || mask[i + 3] !== 255) nonOpaque++;
    }
    return { colored, outside, visibleMask, nonOpaque };
  }, { diffPng, maskPng });
}

test('diff PNGs mark allowed and forbidden pixels and retain an opaque mask', { timeout: 30000 }, async (t) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  t.after(() => context.close());
  const page = await context.newPage();
  const [before, after] = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1280, 720);
    const before = canvas.toDataURL('image/png').split(',')[1];
    ctx.fillStyle = '#fff'; ctx.fillRect(10, 10, 1, 1); ctx.fillRect(20, 20, 1, 1);
    return [before, canvas.toDataURL('image/png').split(',')[1]];
  });
  const diff = await compareFrames(page, Buffer.from(before, 'base64'), Buffer.from(after, 'base64'),
    { rects: [{ name: 'allowed', x: 9, y: 9, width: 3, height: 3 }] });
  assert.equal(diff.changed, 2);
  assert.equal(diff.outsideBounds, 1);
  assert.equal(diff.treePixels.allowed, 1);
  assert.deepEqual(await inspectArtifacts(page, diff), { colored: 2, outside: 1, visibleMask: 0, nonOpaque: 0 });
});

test('absent, spring and invalid season URLs produce the same spring frame and scene', { timeout: 90000 }, async () => {
  const frames = [];
  try {
    for (const season of [undefined, 'spring', 'invalid', 'AUTUMN']) {
      const frame = await openFrame(browser, url, scenarios[1], season);
      frames.push(frame);
    }
    const baseline = await screenshot(frames[0]);
    const state = await inspectFrame(frames[0].page);
    assert.equal(state.label, 'Spring');
    for (const frame of frames.slice(1)) {
      assert.deepEqual(await inspectFrame(frame.page), state);
      const diff = await compareFrames(frame.page, baseline, await screenshot(frame));
      assert.equal(diff.changed, 0);
    }
    for (const frame of frames) assert.deepEqual(frame.errors, []);
  } finally { for (const frame of frames) await frame.context.close(); }
});

test('autumn changes only visible crown pixels and the HTML label across phases, weather and a placed plot', { timeout: 240000 }, async (t) => {
  const checks = [...scenarios.filter((scenario) => !scenario.openHud),
    { name: 'placed-plot', phase: 'daytime', weather: 'clear', plot: true }];
  for (const scenario of checks) {
    const spring = await openFrame(browser, url, scenario);
    const autumn = await openFrame(browser, url, scenario, 'autumn');
    try {
      const before = await screenshot(spring), after = await screenshot(autumn);
      const a = await inspectFrame(spring.page), b = await inspectFrame(autumn.page);
      assertOnlyCrownMaterials(a, b);
      const silhouette = await captureCrownSilhouette(autumn);
      const diff = await compareFrames(autumn.page, before, after,
        { rects: a.rects, labelRects: [a.labelRect, b.labelRect], silhouette });
      assert.ok(diff.changed > 0, `${scenario.name}: no visible change`);
      assert.ok(diff.labelPixels > 0, `${scenario.name}: season label did not change`);
      for (const [tree, count] of Object.entries(diff.treePixels)) {
        assert.ok(count > 0, `${scenario.name}: ${tree} did not change`);
      }
      assert.equal(diff.outsideBounds, 0, `${scenario.name}: outside crown bounds/label: ${JSON.stringify(diff.outsideBoundsRect)}`);
      assert.equal(diff.outsideSilhouette, 0, `${scenario.name}: pixels changed outside the visible crowns/label`);
      assert.ok(diff.crownPixels > 0, `${scenario.name}: no visible crown mask`);
      assert.deepEqual(await inspectArtifacts(autumn.page, diff),
        { colored: diff.changed, outside: 0, visibleMask: diff.crownPixels, nonOpaque: 0 });
      if (scenario.name === 'day' || scenario.name === 'sunset') {
        assert.equal(diff.over250, 0, `${scenario.name}: ${diff.over250} crown pixels have a channel above 250`);
      }
      assert.deepEqual(spring.errors, [], `${scenario.name} spring console`);
      assert.deepEqual(autumn.errors, [], `${scenario.name} autumn console`);
      t.diagnostic(`${scenario.name}: ${diff.changed} changed, ${diff.outsideBounds} outside bounds, ` +
        `${diff.outsideSilhouette} outside visible crowns; max crown channel ${diff.maxChannel}`);
    } finally { await spring.context.close(); await autumn.context.close(); }
  }
});

test('opening the existing sky panel does not change autumn scene data or the label', { timeout: 60000 }, async () => {
  const scenario = scenarios.find((item) => item.openHud);
  const spring = await openFrame(browser, url, scenario);
  const autumn = await openFrame(browser, url, scenario, 'autumn');
  try {
    assertOnlyCrownMaterials(await inspectFrame(spring.page), await inspectFrame(autumn.page));
    assert.equal(await autumn.page.locator('#sky-panel').isVisible(), true);
    assert.deepEqual(spring.errors, []);
    assert.deepEqual(autumn.errors, []);
  } finally { await spring.context.close(); await autumn.context.close(); }
});
