import * as THREE from 'three';
import { createScene, GROUND_HEIGHT } from '/src/scene/createScene.ts';
import { createFarmLayout } from '/src/scene/createFarmLayout.ts';
import { FARM_PALETTE } from '/src/scene/farmPalette.ts';
import { createPlacementVisual } from '/src/placement/createPlacementVisual.ts';
import { createDayNightCycle } from '/src/lighting/createDayNightCycle.ts';
import { createComposer } from '/src/postprocess/index.ts';

const params = new URLSearchParams(location.search);
const id = params.get('id');
const category = params.get('category');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '') || !['trees', 'rocks', 'fences', 'props', 'farm'].includes(category)) {
  throw new Error('Invalid asset identifier');
}
const asset = await import(/* @vite-ignore */ `/src/assets/${category}/${id}.ts?t=${Date.now()}`);
const { scene, camera, renderer, ground, resize } = createScene(document.querySelector('#scene'));
const layout = createFarmLayout(scene);
const layoutGroup = scene.getObjectByName('farm-layout');
const fence = createPlacementVisual('fence');
fence.position.set(0, GROUND_HEIGHT, 3.9);
scene.add(fence);
// Use the game's own day/night setup, including its existing cottage lights.
// The unplaced dummy character and its carried lantern are not in the scene.
const lighting = createDayNightCycle({ scene, character: new THREE.Group(), windows: layout.windows, extraEmissives: layout.extraEmissives });
lighting.setDayNightPhase('daytime');
const subject = asset.build();
scene.add(subject);
const composer = createComposer(renderer, scene, camera);
resize();
composer.resize(innerWidth, innerHeight, devicePixelRatio);

function setView(view, surface = 'grass', zoom = 1) {
  const context = view === 'context';
  layoutGroup.visible = context;
  fence.visible = context;
  subject.position.set(context ? 2.5 : 0, GROUND_HEIGHT, context ? 3 : 0);
  ground.material.color.setHex(surface === 'path' ? FARM_PALETTE.dirt : FARM_PALETTE.grass);
  const target = new THREE.Vector3(0, GROUND_HEIGHT + 0.7, 0);
  const offset = view === 'front' ? new THREE.Vector3(0, 7, 12)
    : view === 'side' ? new THREE.Vector3(12, 7, 0) : new THREE.Vector3(12, 12, 12);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
  subject.visible = true;
  composer.render();
}

function pixels() {
  const gl = renderer.getContext();
  const result = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, result);
  return result;
}

function measure(view, surface, delta) {
  setView(view, surface, 1);
  const withAsset = pixels();
  subject.visible = false;
  composer.render();
  const withoutAsset = pixels();
  subject.visible = true;
  composer.render();
  const gl = renderer.getContext();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  let count = 0;
  let contrast = 0;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let i = 0; i < withAsset.length; i += 4) {
    const dr = Math.abs(withAsset[i] - withoutAsset[i]);
    const dg = Math.abs(withAsset[i + 1] - withoutAsset[i + 1]);
    const db = Math.abs(withAsset[i + 2] - withoutAsset[i + 2]);
    if (Math.max(dr, dg, db) < delta) continue;
    const pixel = i / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    count++;
    contrast += Math.hypot(dr, dg, db);
  }
  return { view, surface, pixels: count, widthPixels: count ? maxX - minX + 1 : 0,
    heightPixels: count ? maxY - minY + 1 : 0, meanContrastRGB: count ? contrast / count : 0,
    renderWidth: width, renderHeight: height };
}

window.__assetgen = {
  setView,
  measure,
  state: () => ({ pixel: composer.getState(), references: {
    cottage: !!scene.getObjectByName('farm-cottage'), coop: !!scene.getObjectByName('farm-ramp-coop-1'),
    tree: !!scene.getObjectByName('farm-tree-2'), fence: !!fence,
  } }),
};
setView('iso');
