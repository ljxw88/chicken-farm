import { createComposer, isPixelRenderingEnabled } from '../postprocess';
import type { AppContext } from './context';

export function registerPresentation(context: AppContext) {
  const composer = createComposer(context.renderer, context.scene, context.camera);
  context.composer = composer;
  window.setPixelRendering = composer.setEnabled;
  window.setPixelSize = composer.setPixelSize;
  window.getPixelRendering = composer.getState;

  context.lastDevicePixelRatio = window.devicePixelRatio;
  function handleResize() {
    context.resize();
    composer.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    context.lastDevicePixelRatio = window.devicePixelRatio;
  }
  context.handleResize = handleResize;
  handleResize();
  // The default stays on; ?pixel=0 is a console-free native comparison.
  if (!isPixelRenderingEnabled(window.location.search)) composer.setEnabled(false);
  window.addEventListener('resize', handleResize);
}
