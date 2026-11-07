import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { historicalFixtures, outputDirectory } from './evidence-path.mjs';

// EBR-88 captured both revisions with streaks hidden at the exact Gate G pose,
// timestamp and RNG seed. Use their shared underlying frame as the mask oracle.
const root = join(historicalFixtures, 'EBR-75/gate-g');
const historical = join(root, 'dcbaf70');
const output = outputDirectory('compare-ebr75-rain-mask');
const oldBaseline = JSON.parse(await readFile(join(historical, 'baseline.json'), 'utf8'));
const newBaseline = JSON.parse(await readFile(join(root, 'baseline.json'), 'utf8'));
const oldParity = JSON.parse(await readFile(join(historical, 'parity.json'), 'utf8'));
assert.equal(oldBaseline.sourceSha, 'dcbaf70b8f2c1038afe5c0b70f506ec7de931214');
assert.equal(newBaseline.sourceSha, '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff');
assert.deepEqual(oldParity.stateMismatches, []);
for (const [name, result] of Object.entries(oldParity.results)) {
  assert.equal(result.changedPixels, name === 'rain' ? 31407 : 0, name);
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const oldRain = await readFile(join(historical, 'baseline/rain.png'));
const newRain = await readFile(join(historical, 'candidate/rain.png'));
const oldHidden = await readFile(join(historicalFixtures, 'EBR-88/merge-dcbaf70/main/day-rain-no-streaks.png'));
const newHidden = await readFile(join(historicalFixtures, 'EBR-88/merge-dcbaf70/merged/day-rain-no-streaks.png'));
assert.equal(hash(oldRain), oldBaseline.frames.rain.sha256);
assert.equal(hash(newRain), newBaseline.frames.rain.sha256, 'Candidate rain must match the new QA baseline');
assert.equal(hash(oldHidden), hash(newHidden), 'The hidden-streak reference must be identical at both revisions');

const browser = await chromium.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const result = await page.evaluate(async (encoded) => {
    async function pixels(data) {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { canvas, context, data: context.getImageData(0, 0, image.width, image.height) };
    }
    const [before, after, noStreaks] = await Promise.all(encoded.map(pixels));
    if ([before, after, noStreaks].some(({ canvas }) => canvas.width !== 1280 || canvas.height !== 720)) {
      throw new Error('Unexpected Gate G image dimensions');
    }
    const mask = before.context.createImageData(1280, 720);
    const outside = before.context.createImageData(1280, 720);
    let changedPixels = 0;
    let maskPixels = 0;
    let outsideMaskPixels = 0;
    const differs = (a, b, i) => a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
    for (let i = 0; i < before.data.data.length; i += 4) {
      const changed = differs(before.data.data, after.data.data, i);
      const inMask = differs(before.data.data, noStreaks.data.data, i) || differs(after.data.data, noStreaks.data.data, i);
      if (changed) changedPixels++;
      if (inMask) { maskPixels++; mask.data[i] = 255; mask.data[i + 2] = 255; }
      if (changed && !inMask) { outsideMaskPixels++; outside.data[i] = 255; }
      mask.data[i + 3] = outside.data[i + 3] = 255;
    }
    before.context.putImageData(mask, 0, 0);
    const maskPng = before.canvas.toDataURL('image/png').split(',')[1];
    before.context.putImageData(outside, 0, 0);
    return { changedPixels, maskPixels, outsideMaskPixels, maskPng,
      outsidePng: before.canvas.toDataURL('image/png').split(',')[1] };
  }, [oldRain, newRain, oldHidden].map((bytes) => bytes.toString('base64')));
  assert.equal(result.changedPixels, 31407);
  assert.equal(result.outsideMaskPixels, 0);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'rain-streak-mask.png'), Buffer.from(result.maskPng, 'base64'));
  await writeFile(join(output, 'rain-outside-mask.png'), Buffer.from(result.outsidePng, 'base64'));
  const report = { oldBaselineSha: oldBaseline.sourceSha, newBaselineSha: newBaseline.sourceSha,
    candidateSha: oldParity.candidateSha, browser: browser.version(), viewport: { width: 1280, height: 720 },
    hiddenStreakSha256: hash(oldHidden), oldRainSha256: hash(oldRain), newRainSha256: hash(newRain),
    changedPixels: result.changedPixels, streakMaskPixels: result.maskPixels, outsideMaskPixels: result.outsideMaskPixels,
    otherFramesChangedPixels: 0 };
  await writeFile(join(output, 'rain-mask.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Rain: ${report.changedPixels} changed pixels; ${report.outsideMaskPixels} outside the streak mask; seven other frames: 0`);
} finally {
  await browser.close();
}
