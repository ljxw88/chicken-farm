import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { calculatePixelViewport } = await vite.ssrLoadModule('/src/postprocess/pixelViewport.ts');
const { createComposer, isPixelRenderingEnabled } = await vite.ssrLoadModule('/src/postprocess/index.ts');
after(() => vite.close());

class FakeRenderer {
  domElement = { width: 300, height: 150, style: {} };
  width = 300;
  height = 150;
  pixelRatio = 1;
  target = null;
  autoClear = true;
  autoClearColor = true;
  autoClearDepth = true;
  autoClearStencil = true;
  draws = [];

  getSize(result) { return result.set(this.width, this.height); }
  getPixelRatio() { return this.pixelRatio; }
  setPixelRatio(value) { this.pixelRatio = value; this.setSize(this.width, this.height); }
  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.domElement.width = Math.floor(width * this.pixelRatio);
    this.domElement.height = Math.floor(height * this.pixelRatio);
  }
  getRenderTarget() { return this.target; }
  setRenderTarget(target) { this.target = target; }
  clear() {}
  render(scene, camera) { this.draws.push({ scene, camera, target: this.target }); }
}

function fixture(t) {
  const renderer = new FakeRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera();
  const composer = createComposer(renderer, scene, camera);
  t.after(composer.dispose);
  return { renderer, scene, camera, composer };
}

test('integer device-pixel blocks retain approximately the same CSS size at different DPRs', () => {
  const one = calculatePixelViewport(1280, 720, 1, 4);
  const two = calculatePixelViewport(2560, 1440, 2, 4);
  assert.deepEqual([one.targetWidth, one.targetHeight, one.pixelSize], [320, 180, 4]);
  assert.deepEqual([two.targetWidth, two.targetHeight, two.pixelSize], [320, 180, 8]);
  assert.deepEqual([one.cropLeft, one.cropRight, one.cropTop, one.cropBottom], [0, 0, 0, 0]);

  const mobile = calculatePixelViewport(390 * 3, 844 * 3, 3, 4);
  assert.deepEqual([mobile.targetWidth, mobile.targetHeight, mobile.pixelSize], [98, 211, 12]);
  assert.deepEqual([mobile.cropLeft, mobile.cropRight], [3, 3]);
});

test('the URL defaults to pixel rendering and permits a console-free native comparison', () => {
  assert.equal(isPixelRenderingEnabled(''), true);
  assert.equal(isPixelRenderingEnabled('?pixel=1'), true);
  assert.equal(isPixelRenderingEnabled('?pixel=0'), false);
  assert.equal(isPixelRenderingEnabled('?other=1&pixel=0'), false);
  assert.equal(isPixelRenderingEnabled('?pixel=unknown'), true);
});

test('odd and fractional viewports are fully covered with centered partial edge blocks', () => {
  for (const [width, height, dpr, size] of [
    [853, 607, 1.25, 4], [389, 841, 1.3, 3], [1365, 767, 2, 4],
    [97, 31, 0.8, 2.5], [1, 1, 2, 16], [0, 0, 1, 4],
  ]) {
    const v = calculatePixelViewport(width * dpr, height * dpr, dpr, size);
    assert.equal(Number.isInteger(v.pixelSize), true);
    assert.ok(v.pixelSize >= 1);
    assert.ok(v.targetWidth >= 1 && v.targetHeight >= 1);
    assert.equal(v.targetWidth * v.pixelSize - v.cropLeft - v.cropRight, Math.ceil(width * dpr));
    assert.equal(v.targetHeight * v.pixelSize - v.cropTop - v.cropBottom, Math.ceil(height * dpr));
    assert.ok(Math.abs(v.cropLeft - v.cropRight) <= 1);
    assert.ok(Math.abs(v.cropTop - v.cropBottom) <= 1);
  }
});

test('the world draws to a low-resolution canvas and native comparison restores the original DPR cap', (t) => {
  const { renderer, scene, camera, composer } = fixture(t);
  composer.resize(1280, 720, 2);
  let state = composer.getState();
  assert.equal(state.enabled, true);
  assert.equal(state.cssPixelSize, 4);
  assert.deepEqual([state.canvasWidth, state.canvasHeight], [320, 180]);
  assert.equal(state.viewport.pixelSize, 8);
  assert.equal(renderer.domElement.style.width, '320px');
  assert.equal(renderer.domElement.style.height, '180px');
  assert.equal(renderer.domElement.style.transform, 'translate(0px, 0px) scale(4)');
  assert.equal(renderer.domElement.style.imageRendering, 'pixelated');
  composer.render(1 / 60);
  assert.deepEqual(renderer.draws.at(-1), { scene, camera, target: null });

  composer.resize(390, 844, 3);
  state = composer.getState();
  assert.deepEqual([state.canvasWidth, state.canvasHeight], [98, 211]);
  assert.equal(state.viewport.pixelSize, 12);
  assert.equal(renderer.domElement.style.width, '98px');
  assert.equal(renderer.domElement.style.transform, 'translate(-1px, 0px) scale(4)');

  composer.setEnabled(false);
  state = composer.getState();
  assert.equal(state.enabled, false);
  assert.equal(state.rendererPixelRatio, 2);
  assert.deepEqual([state.canvasWidth, state.canvasHeight], [780, 1688]);
  assert.equal(renderer.domElement.style.width, '390px');
  assert.equal(renderer.domElement.style.transform, 'none');
  assert.equal(renderer.domElement.style.imageRendering, 'auto');
  composer.render(1 / 60);
  assert.deepEqual(renderer.draws.at(-1), { scene, camera, target: null });
});

test('resize and optional scale changes update the presentation without leaking mutable state', (t) => {
  const { renderer, composer } = fixture(t);
  composer.resize(853, 607, 1.25);
  let state = composer.getState();
  assert.deepEqual([state.viewport.displayWidth, state.viewport.displayHeight], [1067, 759]);
  assert.deepEqual([state.canvasWidth, state.canvasHeight, state.viewport.pixelSize], [214, 152, 5]);
  assert.equal(renderer.domElement.style.transform, 'translate(-0.8px, -0.8px) scale(4)');
  state.viewport.pixelSize = 999;
  assert.equal(composer.getState().viewport.pixelSize, 5);

  composer.setPixelSize(2);
  state = composer.getState();
  assert.equal(state.viewport.pixelSize, 3); // 2.5 device pixels rounds to an integer.
  assert.deepEqual([state.canvasWidth, state.canvasHeight], [356, 253]);
  composer.setEnabled(false);
  composer.setPixelSize(6);
  assert.deepEqual([composer.getState().canvasWidth, composer.getState().canvasHeight], [1066, 758]);
  composer.setEnabled(true);
  assert.equal(composer.getState().viewport.pixelSize, 8);
});

test('invalid scale and toggle values are rejected without changing the active configuration', (t) => {
  const { composer } = fixture(t);
  composer.resize(800, 600, 1);
  for (const invalid of [0, -1, 17, NaN, Infinity, '4', null]) {
    assert.throws(() => composer.setPixelSize(invalid), RangeError);
  }
  for (const invalid of [0, 1, 'true', null]) {
    assert.throws(() => composer.setEnabled(invalid), TypeError);
  }
  assert.equal(composer.getState().cssPixelSize, 4);
  assert.equal(composer.getState().enabled, true);
});
