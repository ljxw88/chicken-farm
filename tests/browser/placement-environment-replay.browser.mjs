import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { compareFoldFeedbackFrame, comparePlacementEnvironmentReplay } from '../../tools/placement-environment-replay.mjs';

test('fold and isolated placement feedback are allowed, but unrelated changes still fail', { timeout: 45000 }, async (t) => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const fixtures = await page.evaluate(() => {
    const black = [0, 0, 0, 255]; const red = [200, 0, 0, 255];
    const green = [0, 200, 0, 255]; const blue = [0, 0, 200, 255];
    function png(colors) {
      const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 1;
      const context = canvas.getContext('2d'); const image = context.createImageData(4, 1);
      colors.forEach((color, index) => image.data.set(color, index * 4));
      context.putImageData(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }
    const baseline = png([black, black, black, black]);
    const hudRects = { controls: { left: 1, top: 0, right: 3, bottom: 1 } };
    return {
      valid: { baseline, candidate: png([red, green, red, black]), hiddenFold: png([black, green, green, black]),
        hiddenFeature: baseline, hudRects },
      unexpected: { baseline, candidate: png([red, green, red, blue]), hiddenFold: png([black, green, green, blue]),
        hiddenFeature: png([black, black, black, blue]), hudRects },
      hiddenMismatch: { baseline, candidate: png([red, green, red, black]), hiddenFold: png([black, green, green, black]),
        hiddenFeature: png([blue, black, black, black]), hudRects },
    };
  });
  const valid = await page.evaluate(compareFoldFeedbackFrame, fixtures.valid);
  assert.deepEqual({ changed: valid.changed, fold: valid.foldPixels, feedback: valid.feedbackPixels, overlap: valid.overlapPixels,
    masked: valid.masked, outside: valid.outside, hiddenMismatch: valid.hiddenMismatch,
    foldOnlyOutside: valid.foldOnlyOutside, feedbackChangedOutsideFold: valid.feedbackChangedOutsideFold,
    bounds: valid.bounds, hudChanged: valid.hudChanged },
  { changed: 3, fold: 2, feedback: 2, overlap: 1, masked: 3, outside: 0, hiddenMismatch: 0,
    foldOnlyOutside: 1, feedbackChangedOutsideFold: 1, bounds: [0, 0, 2, 0], hudChanged: { controls: 2 } });
  const unexpected = await page.evaluate(compareFoldFeedbackFrame, fixtures.unexpected);
  assert.equal(unexpected.outside, 1, 'an unrelated pixel must remain outside the declared masks');
  assert.equal(unexpected.hiddenMismatch, 1, 'the independently hidden frame must still match the reference');
  const hiddenMismatch = await page.evaluate(compareFoldFeedbackFrame, fixtures.hiddenMismatch);
  assert.equal(hiddenMismatch.outside, 0, 'the changed pixel is within the visible mask');
  assert.equal(hiddenMismatch.hiddenMismatch, 1, 'an incorrect feature-hidden frame must not be blessed by the mask');
});

const references = [
  { label: 'dcbaf70', sha: 'dcbaf70b8f2c1038afe5c0b70f506ec7de931214', env: 'EBR75_DCB_BASELINE_WORKTREE' },
  { label: '5d9ba48', sha: '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff', env: 'EBR75_MAIN_BASELINE_WORKTREE' },
];

for (const reference of references) test(`placement and environment replay against clean main ${reference.label}`, { timeout: 300000 }, async (t) => {
  const root = process.cwd();
  let baseline = process.env[reference.env];
  let archiveDir;
  let archivedBaselineSha;
  try {
    if (!baseline) {
      try {
        archiveDir = await mkdtemp('/tmp/opencode/ebr75-main-');
      } catch (error) {
        if (!['EACCES', 'ENOENT'].includes(error.code)) throw error;
        archiveDir = await mkdtemp(join(tmpdir(), 'ebr75-main-'));
      }
      // A clean archive avoids creating or force-removing another Git worktree.
      archivedBaselineSha = reference.sha;
      const resolved = execFileSync('git', ['rev-parse', `${reference.sha}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
      if (resolved !== reference.sha) throw new Error(`Unexpected baseline: ${resolved}`);
      baseline = join(archiveDir, 'checkout');
      await mkdir(baseline);
      const archive = join(archiveDir, 'baseline.tar');
      execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, reference.sha,
        'index.html', 'package.json', 'package-lock.json', 'src'], { cwd: root });
      execFileSync('tar', ['-xf', archive, '-C', baseline]);
      await symlink(join(root, 'node_modules'), join(baseline, 'node_modules'), 'dir');
    }
    const report = await comparePlacementEnvironmentReplay({ baselineRoot: resolve(baseline), candidateRoot: root,
      baselineSha: reference.sha, archivedBaselineSha,
      evidenceDir: process.env.EBR75_REPLAY_EVIDENCE_DIR && resolve(process.env.EBR75_REPLAY_EVIDENCE_DIR, reference.label) });
    t.diagnostic(`Identical traces: ${Object.entries(report.results).map(([name, result]) => `${name}=${result.samples}`).join(', ')}`);
    t.diagnostic(`Additional frames with the new fold hidden: ${Object.keys(report.visualResults).length}; body-only: ${report.intendedBodyChanges.length}; expected EBR-88 rain changes: ${report.expectedRainChanges.length}; unexpected: ${report.unexpectedVisualChanges.length}`);
  } finally {
    if (archiveDir) await rm(archiveDir, { recursive: true });
  }
});
