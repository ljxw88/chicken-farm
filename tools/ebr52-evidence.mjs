import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { verifyBaselineArchive } from './baseline-archive.mjs';
import { assertOnlyCrownMaterials, browserArgs, captureCrownSilhouette, compareFrames, cropImage, inspectFrame,
  openFrame, projectedObjects, scenarios, screenshot, serve, viewport } from './ebr52-capture.mjs';

// Evidence is deliberately external. --full requires the verified pre-gate
// archive, so a candidate can never silently become its own main reference.
const mainSha = 'e9a265f25fe89588ee74d3448f94877b96708ed1';
const args = process.argv.slice(2);
if (args.length !== 1 || !['--frames-only', '--full'].includes(args[0])) {
  throw new Error('Usage: EBR52_EVIDENCE_DIR=<external-dir> EBR52_URL=<dev-url> node tools/ebr52-evidence.mjs --frames-only|--full');
}
if (!process.env.EBR52_EVIDENCE_DIR) throw new Error('Set EBR52_EVIDENCE_DIR outside the worktree');
const output = resolve(process.env.EBR52_EVIDENCE_DIR);
const evidenceRoot = '/home/michael/OpenBot/Shared/farm-evidence/EBR-52/';
assert.ok(output.startsWith(evidenceRoot), `Evidence must be under ${evidenceRoot}`);
const full = args[0] === '--full';
const root = process.env.EBR52_BASELINE_ROOT;
if (full && !root) throw new Error('--full requires EBR52_BASELINE_ROOT for verified main e9a265f');
const url = process.env.EBR52_URL || 'http://100.88.150.21:5218';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = { headSha: git('rev-parse', 'HEAD'), sourceStatus: git('status', '--porcelain=v1', '--untracked-files=all', '--',
  'src', 'index.html', 'package.json', 'package-lock.json'), baselineSha: full ? mainSha : null,
  url, viewport, seed: 123, scenarios: {}, crops: {}, violations: [] };
for (const name of ['frames', 'crops', 'diff', 'mask', ...(full ? ['main', 'default-diff'] : [])]) {
  await mkdir(join(output, name), { recursive: true });
}
const save = (path, bytes) => writeFile(join(output, path), bytes, { flag: 'wx' });
const metrics = ({ diffPng, maskPng, ...values }) => values;
let baseline;
let browser;
try {
  if (full) {
    await verifyBaselineArchive(resolve(root), mainSha);
    baseline = await serve(resolve(root));
    report.baselineUrl = baseline.url;
  }
  browser = await chromium.launch({ headless: true, args: browserArgs });
  report.browser = browser.version();
  for (const scenario of full ? scenarios : scenarios.slice(0, 4)) {
    const spring = await openFrame(browser, url, scenario);
    const autumn = await openFrame(browser, url, scenario, 'autumn');
    let main;
    try {
      const before = await screenshot(spring), after = await screenshot(autumn);
      const a = await inspectFrame(spring.page), b = await inspectFrame(autumn.page);
      assertOnlyCrownMaterials(a, b);
      const silhouette = await captureCrownSilhouette(autumn);
      const diff = await compareFrames(autumn.page, before, after,
        { rects: a.rects, labelRects: [a.labelRect, b.labelRect], silhouette });
      const result = { defaultSha256: sha256(before), autumnSha256: sha256(after),
        crownBounds: a.rects, labelRects: [a.labelRect, b.labelRect], autumnDiff: metrics(diff) };
      await save(`frames/default-${scenario.name}.png`, before);
      await save(`frames/autumn-${scenario.name}.png`, after);
      await save(`diff/autumn-v-default-${scenario.name}.png`, Buffer.from(diff.diffPng, 'base64'));
      await save(`mask/visible-crowns-${scenario.name}.png`, Buffer.from(diff.maskPng, 'base64'));
      if (!diff.changed || !diff.labelPixels || diff.outsideBounds || diff.outsideSilhouette) {
        report.violations.push({ scenario: scenario.name, kind: 'autumn-pixel-containment',
          outsideBounds: diff.outsideBounds, outsideSilhouette: diff.outsideSilhouette });
      }
      if (['day', 'sunset'].includes(scenario.name) && diff.over250) {
        report.violations.push({ scenario: scenario.name, kind: 'crown-channel-above-250', count: diff.over250 });
      }
      if (scenario.openHud && diff.outsideBounds) {
        result.note = 'The unchanged open sky panel blurs the crowns through its existing backdrop-filter; its blur spreads their colour beyond padded crown bounds. The open-panel silhouette includes glass and text, so its maximum channel is not a crown-only brightness measurement.';
        // Diagnostic only: disable blur in both captures to isolate its effect.
        // This does not change the shipped HUD or waive the real-frame gate.
        for (const frame of [spring, autumn]) {
          await frame.page.evaluate(() => {
            const panel = document.querySelector('#sky-panel');
            panel.style.setProperty('backdrop-filter', 'none', 'important');
            panel.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
          });
        }
        const control = await compareFrames(autumn.page, await screenshot(spring), await screenshot(autumn),
          { rects: a.rects, labelRects: [a.labelRect, b.labelRect] });
        result.noBackdropDiagnostic = metrics(control);
        await save('diff/autumn-open-hud-no-backdrop-diagnostic.png', Buffer.from(control.diffPng, 'base64'));
      }
      if (full) {
        main = await openFrame(browser, baseline.url, scenario);
        const reference = await screenshot(main);
        const mainState = await inspectFrame(main.page);
        assert.deepEqual(a.pose, mainState.pose, `${scenario.name} default and main poses differ`);
        const defaultDiff = await compareFrames(spring.page, reference, before);
        result.mainSha256 = sha256(reference);
        result.defaultMainDiff = metrics(defaultDiff);
        await save(`main/${scenario.name}.png`, reference);
        await save(`default-diff/${scenario.name}.png`, Buffer.from(defaultDiff.diffPng, 'base64'));
        if (defaultDiff.changed) report.violations.push({ scenario: scenario.name, kind: 'default-main-pixels', count: defaultDiff.changed });
        assert.deepEqual(main.errors, [], `${scenario.name} main console`);
      }
      assert.deepEqual(spring.errors, [], `${scenario.name} default console`);
      assert.deepEqual(autumn.errors, [], `${scenario.name} autumn console`);
      if (scenario.name === 'day') {
        for (const rect of a.rects) {
          const crop = { x: rect.x - 16, y: rect.y - 16, width: rect.width + 32, height: rect.height + 32 };
          await save(`crops/autumn-${rect.name}.png`, await cropImage(autumn.page, after, crop));
          await save(`crops/default-${rect.name}.png`, await cropImage(spring.page, before, crop));
          report.crops[rect.name] = crop;
        }
        const crop = await projectedObjects(autumn.page, ['farm-tree-4', 'farm-ramp-coop-2'], 20);
        await save('crops/autumn-tree-4-coop-b.png', await cropImage(autumn.page, after, crop));
        await save('crops/default-tree-4-coop-b.png', await cropImage(spring.page, before, crop));
        report.crops['tree-4-coop-b'] = crop;
      }
      report.scenarios[scenario.name] = result;
      console.log(`${scenario.name}: autumn=${diff.changed} outside-bounds=${diff.outsideBounds} ` +
        `outside-visible=${diff.outsideSilhouette}${full ? ` default-main=${result.defaultMainDiff.changed}` : ''}`);
    } finally {
      await spring.context.close();
      await autumn.context.close();
      await main?.context.close();
    }
  }

  // An additional, explicitly test-posed view gives Look Dev a readable
  // character/crown comparison without modifying world geometry or the app.
  for (const scenario of [scenarios[1], scenarios[2]]) {
    for (const season of [undefined, 'autumn']) {
      const frame = await openFrame(browser, url, scenario, season);
      try {
        await frame.page.evaluate(() => {
          const { character, camera, follow, composer, dayNight } = window.__ebr52Scene;
          character.position.set(-1.45, 2.4, 2.25);
          dayNight.updateCharacterShadow();
          follow(character.position.clone().set(-1.8, 2.4, 1.9));
          camera.zoom = 2.4;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
          composer.render(0);
        });
        const image = await screenshot(frame);
        const crop = await projectedObjects(frame.page, ['farm-tree-1', 'character'], 22);
        const label = `${season ?? 'default'}-character-beside-crown${scenario.name === 'day' ? '' : '-sunset'}`;
        await save(`frames/${label}.png`, image);
        await save(`crops/${label}.png`, await cropImage(frame.page, image, crop));
        report.crops[label] = { ...crop, testPose: [-1.45, 2.4, 2.25], cameraZoom: 2.4 };
        assert.deepEqual(frame.errors, [], `${label} character crop console`);
      } finally { await frame.context.close(); }
    }
  }
  report.ok = report.violations.length === 0;
  if (full) {
    const comparisons = Object.fromEntries(Object.entries(report.scenarios).map(([name, result]) => [name, {
      changedPixels: result.defaultMainDiff.changed, mainSha256: result.mainSha256, defaultSha256: result.defaultSha256,
    }]));
    await save('default-main-report.json', `${JSON.stringify({ baselineSha: mainSha, headSha: report.headSha, viewport, seed: 123,
      ok: Object.values(comparisons).every((item) => item.changedPixels === 0), comparisons }, null, 2)}\n`);
  }
  await save('report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(`EBR-52 ${report.ok ? 'PASS' : 'FAIL'}: ${output}/report.json`);
  if (!report.ok) process.exitCode = 1;
} finally {
  await browser?.close();
  await baseline?.server.close();
}
