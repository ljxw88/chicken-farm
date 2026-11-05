import type { Camera, Scene, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';

export function createComposer(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
  const composer = new EffectComposer(renderer);
  // A single render pass keeps the existing scene unchanged.
  composer.addPass(new RenderPass(scene, camera));
  return composer;
}
