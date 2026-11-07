import type { WebGLRenderer } from 'three';
import type { PixelViewport } from './pixelViewport';
import { ART_SLOTS } from '../content/slots';
import { PIXEL_PRESENTATION } from '../content/presentation';

// The browser presents the low-resolution canvas with nearest-neighbor scaling.
// Rendering to the canvas (rather than a linear offscreen target) preserves the
// existing Three.js output-color and fog behavior.
export function presentPixelViewport(
  renderer: WebGLRenderer,
  viewport: PixelViewport,
  width: number,
  height: number,
  devicePixelRatio: number,
  enabled: boolean,
) {
  const canvas = renderer.domElement;
  if (enabled) {
    renderer.setPixelRatio(PIXEL_PRESENTATION.pixelRendererRatio);
    renderer.setSize(viewport.targetWidth, viewport.targetHeight, false);
    canvas.style.width = `${viewport.targetWidth}px`;
    canvas.style.height = `${viewport.targetHeight}px`;
    // Transform precision avoids fractional CSS layout rounding changing block widths.
    canvas.style.transformOrigin = '0 0';
    const offsetX = -viewport.cropLeft / devicePixelRatio;
    const offsetY = -viewport.cropTop / devicePixelRatio;
    const scale = viewport.pixelSize / devicePixelRatio;
    canvas.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
    canvas.style.imageRendering = ART_SLOTS.post.pixel.imageRendering;
  } else {
    renderer.setPixelRatio(Math.min(devicePixelRatio, PIXEL_PRESENTATION.nativeDprCap));
    renderer.setSize(width, height, false);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.transform = 'none';
    canvas.style.imageRendering = 'auto';
  }
}
