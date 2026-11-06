import * as THREE from 'three';
import { buildRecipe, setRecipeNightAmount } from '/src/assets/buildRecipe.ts';
import { createScene, GROUND_HEIGHT } from '/src/scene/createScene.ts';
import { createFarmLayout } from '/src/scene/createFarmLayout.ts';
import { FARM_PALETTE } from '/src/scene/farmPalette.ts';
import { createPlacementVisual } from '/src/placement/createPlacementVisual.ts';
import { createCharacter } from '/src/character/createCharacter.ts';
import { createDayNightCycle } from '/src/lighting/createDayNightCycle.ts';
import { createComposer } from '/src/postprocess/index.ts';

const id = new URLSearchParams(location.search).get('id');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new Error('Invalid asset id');
// Local Vite server only; recipes are data and never fetch remote art or code.
let recipe = window.__assetForgeFixture;
if (!recipe) {
  const response = await fetch(`/tools/assetgen/runs/${id}/candidate.json?t=${Date.now()}`);
  if (!response.ok) throw new Error(`Cannot load candidate: ${response.status}`);
  recipe = await response.json();
}
const { scene, camera, renderer, ground, resize } = createScene(document.querySelector('#scene'));
const island = scene.getObjectByName('farm-island');
const layout = createFarmLayout(scene);
const layoutGroup = scene.getObjectByName('farm-layout');
const fence = createPlacementVisual('fence');
fence.position.set(0, GROUND_HEIGHT, 4.1);
scene.add(fence);
const character = createCharacter();
character.position.set(-0.5, GROUND_HEIGHT, 2.6);
scene.add(character);
const lighting = createDayNightCycle({ scene, character, windows: layout.windows, extraEmissives: layout.extraEmissives });
const subject = buildRecipe(recipe);
scene.add(subject);
const composer = createComposer(renderer, scene, camera);
resize();
composer.resize(innerWidth, innerHeight, devicePixelRatio);
const gl = renderer.getContext();

function setView(yaw, phase, surface, context = false) {
  island.visible = surface !== 'void';
  layoutGroup.visible = context;
  fence.visible = context;
  character.visible = context;
  subject.position.set(context ? 2.5 : 0, GROUND_HEIGHT, context ? 3 : 0);
  ground.material.color.setHex(surface === 'path' ? FARM_PALETTE.dirt : FARM_PALETTE.grass);
  lighting.setDayNightPhase(phase);
  // Test-only fault injection: reverse the existing key; never add a light.
  if (window.__assetForgeWrongKey) scene.getObjectByName('day-night-directional').position.multiplyScalar(-1);
  setRecipeNightAmount(subject, phase === 'night' ? 1 : 0);
  const target = new THREE.Vector3(0, GROUND_HEIGHT + 0.7, 0);
  const angle = yaw * Math.PI / 180;
  camera.position.copy(target).add(new THREE.Vector3(Math.sin(angle) * Math.sqrt(288), 12, Math.cos(angle) * Math.sqrt(288)));
  camera.lookAt(target);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  subject.visible = true;
  composer.render();
}

function pixels() {
  const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return data;
}

function png(data) {
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  const image = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) image.set(data.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(image, width, height), 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

const linear = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function hue(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return null;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return (h + 360) % 360;
}

function difference(a, b, delta, withLightingSamples = false) {
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  let count = 0, contrast = 0, hueSum = 0, hueCount = 0;
  let minX = width, maxX = -1, minY = height, maxY = -1;
  const lightingSamples = [];
  const ray = new THREE.Raycaster();
  subject.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]), dg = Math.abs(a[i + 1] - b[i + 1]), db = Math.abs(a[i + 2] - b[i + 2]);
    if (Math.max(dr, dg, db) < delta) continue;
    const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    count++;
    const l1 = luminance(a[i], a[i + 1], a[i + 2]), l2 = luminance(b[i], b[i + 1], b[i + 2]);
    contrast += (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const h1 = hue(a[i], a[i + 1], a[i + 2]), h2 = hue(b[i], b[i + 1], b[i + 2]);
    if (h1 !== null && h2 !== null) { const h = Math.abs(h1 - h2); hueSum += Math.min(h, 360 - h); hueCount++; }
    if (withLightingSamples) {
      ray.setFromCamera(new THREE.Vector2((x + 0.5) / width * 2 - 1, (y + 0.5) / height * 2 - 1), camera);
      const hit = ray.intersectObject(subject, true)[0];
      if (hit?.face) {
        const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
        const material = hit.object.material;
        const color = material.color;
        const albedo = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
        lightingSamples.push({ normal: normal.toArray(), luminance: l1, albedo });
      }
    }
  }
  return { pixels: count, widthPixels: count ? maxX - minX + 1 : 0, heightPixels: count ? maxY - minY + 1 : 0,
    meanContrastRatio: count ? contrast / count : 0, meanHueDifference: hueCount ? hueSum / hueCount : 0, lightingSamples };
}

function capture(yaw, phase, surface, delta, featureIds) {
  setView(yaw, phase, surface);
  const present = pixels();
  const image = png(present);
  subject.visible = false; composer.render();
  const absent = pixels();
  subject.visible = true; composer.render();
  const measured = difference(present, absent, delta, phase === 'daytime' && surface === 'grass');
  const identities = {};
  const identityParts = {};
  if (phase === 'daytime' && surface === 'grass') for (const feature of featureIds) {
    const meshes = subject.children.filter((child) => child.userData.feature === feature);
    meshes.forEach((mesh) => { mesh.visible = false; });
    composer.render();
    identities[feature] = difference(present, pixels(), delta).pixels;
    meshes.forEach((mesh) => { mesh.visible = true; });
    for (const mesh of meshes) {
      mesh.visible = false;
      composer.render();
      identityParts[mesh.name] = { feature, pixels: difference(present, pixels(), delta).pixels };
      mesh.visible = true;
    }
  }
  subject.visible = true;
  composer.render();
  return { image, measured, identities, identityParts };
}

function silhouette(yaw, surface) {
  setView(yaw, 'daytime', surface);
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const saved = [];
  subject.traverse((object) => {
    if (object.isMesh) { saved.push([object, object.material]); object.material = black; }
  });
  composer.render();
  const image = png(pixels());
  for (const [object, material] of saved) object.material = material;
  black.dispose();
  composer.render();
  return image;
}

window.__assetForge = {
  capture,
  silhouette,
  setView,
  native(enabled) { composer.setEnabled(!enabled); composer.render(); },
  reference(yaw, zoom) {
    setView(yaw, 'daytime', 'grass');
    composer.setEnabled(false);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    composer.render();
  },
  state() {
    const directional = scene.getObjectByName('day-night-directional');
    const height = (object) => new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).y;
    const key = directional.position.clone().normalize();
    if (window.__assetForgeWrongKey) key.negate(); // Compare to the intended key, not the injected fault.
    return { pixel: composer.getState(), keyDirection: key.toArray(), subjectHeight: height(subject),
      references: { cottage: height(scene.getObjectByName('farm-cottage')), coop: height(scene.getObjectByName('farm-ramp-coop-1')),
        tree: height(scene.getObjectByName('farm-tree-2')), fence: height(fence), character: height(character) } };
  },
};
setView(45, 'daytime', 'grass');
