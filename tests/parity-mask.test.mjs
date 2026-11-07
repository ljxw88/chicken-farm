import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { compareParityFrames } from '../tools/parity-diff.mjs';

test('only visible non-black mask pixels allow changes, and mismatched masks fail', async (t) => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const frames = await page.evaluate(() => {
    function png(colors) {
      const canvas = document.createElement('canvas');
      canvas.width = colors.length;
      canvas.height = 1;
      const context = canvas.getContext('2d');
      const data = context.createImageData(colors.length, 1);
      colors.forEach((color, index) => data.data.set(color, index * 4));
      context.putImageData(data, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }
    return {
      reference: png(Array(4).fill([0, 0, 0, 255])),
      candidate: png([[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 0, 255]]),
      mask: png([[255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 0], [255, 0, 0, 128]]),
      badMask: png([[255, 255, 255, 255]]),
    };
  });
  const unmasked = await page.evaluate(compareParityFrames, { ...frames, mask: null });
  const masked = await page.evaluate(compareParityFrames, frames);
  assert.equal(unmasked.changedPixels, 4);
  assert.equal(unmasked.outsideMaskPixels, 4);
  assert.equal(masked.changedPixels, 4);
  assert.equal(masked.outsideMaskPixels, 2);
  await assert.rejects(page.evaluate(compareParityFrames, { ...frames, mask: frames.badMask }), /Mask dimensions differ/);
});
