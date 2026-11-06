import type { Camera, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { presentPixelViewport } from './PixelPresentation';
import { calculatePixelViewport, type PixelViewport } from './pixelViewport';

// Look Dev LOCKED: 4 CSS pixels per world pixel (about 320 wide at 1280x720).
const DEFAULT_CSS_PIXEL_SIZE = 4;

export function isPixelRenderingEnabled(search: string) {
  return new URLSearchParams(search).get('pixel') !== '0';
}

export interface PixelRenderingState {
  enabled: boolean;
  cssPixelSize: number;
  devicePixelRatio: number;
  rendererPixelRatio: number;
  canvasWidth: number;
  canvasHeight: number;
  viewport: PixelViewport;
}

export function createComposer(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(1);
  // Keep this pass on the canvas: an offscreen linear OutputPass changes how
  // Three.js blends the scene's existing fog and therefore changes its look.
  composer.addPass(new RenderPass(scene, camera));

  let enabled = true;
  let cssPixelSize = DEFAULT_CSS_PIXEL_SIZE;
  let width = 1;
  let height = 1;
  let devicePixelRatio = 1;
  let viewport = calculatePixelViewport(1, 1, 1, cssPixelSize);

  function resize(nextWidth: number, nextHeight: number, nextDevicePixelRatio: number) {
    width = nextWidth;
    height = nextHeight;
    devicePixelRatio = nextDevicePixelRatio;
    viewport = calculatePixelViewport(
      width * devicePixelRatio,
      height * devicePixelRatio,
      devicePixelRatio,
      cssPixelSize,
    );
    presentPixelViewport(renderer, viewport, width, height, devicePixelRatio, enabled);
    if (enabled) composer.setSize(viewport.targetWidth, viewport.targetHeight);
  }

  function setEnabled(value: boolean) {
    if (typeof value !== 'boolean') throw new TypeError('Pixel rendering expects a boolean');
    enabled = value;
    resize(width, height, devicePixelRatio);
  }

  function setPixelSize(value: number) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 16) {
      throw new RangeError('Pixel size must be between 1 and 16 CSS pixels');
    }
    cssPixelSize = value;
    resize(width, height, devicePixelRatio);
  }

  function getState(): PixelRenderingState {
    return {
      enabled,
      cssPixelSize,
      devicePixelRatio,
      rendererPixelRatio: renderer.getPixelRatio(),
      canvasWidth: renderer.domElement.width,
      canvasHeight: renderer.domElement.height,
      viewport: { ...viewport },
    };
  }

  function render(deltaSeconds?: number) {
    const previousTarget = renderer.getRenderTarget();
    if (enabled) {
      composer.render(deltaSeconds);
    } else {
      // Comparison mode is the original native-resolution, antialiased world render.
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    renderer.setRenderTarget(previousTarget);
  }

  function dispose() {
    for (const pass of composer.passes) pass.dispose();
    composer.dispose();
  }

  return { render, resize, setEnabled, setPixelSize, getState, dispose };
}
