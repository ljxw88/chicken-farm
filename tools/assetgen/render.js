import * as THREE from 'three';
import { buildRecipe, setRecipeNightAmount } from '/src/assets/buildRecipe.ts';
import { createScene, GROUND_HEIGHT, GROUND_SIZE } from '/src/scene/createScene.ts';
import { createFarmLayout } from '/src/scene/createFarmLayout.ts';
import { createStoneStairs } from '/src/scene/createStoneStairs.ts';
import { FARM_PALETTE } from '/src/scene/farmPalette.ts';
import { createPlacementVisual } from '/src/placement/createPlacementVisual.ts';
import { createCharacter } from '/src/character/createCharacter.ts';
import { createDayNightCycle } from '/src/lighting/createDayNightCycle.ts';
import { createWeatherSystem } from '/src/weather/createWeatherSystem.ts';
import { createComposer } from '/src/postprocess/index.ts';
import { deltaE76, luminanceRGB } from '/tools/assetgen/color.js';

const id = new URLSearchParams(location.search).get('id');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id || '')) throw new Error('Invalid asset id');
// Local Vite server only; recipes are data and never fetch remote art or code.
let recipe = window.__assetForgeFixture;
const signedType = window.__assetForgeSigned;
if (!recipe && !signedType) {
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
let randomState = 0xeb830001;
const weather = createWeatherSystem({ scene, camera, anchor: character, groundHeight: GROUND_HEIGHT, groundSize: GROUND_SIZE,
  splashExclusions: layout.splashExclusions, setDirectionalIntensityMultiplier: lighting.setDirectionalIntensityMultiplier,
  setAmbientHemisphereColorMultiplier: lighting.setAmbientHemisphereColorMultiplier, setShadowWeather: lighting.setShadowWeather,
  random: () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296; } });
function signedSubject(type) {
  let original;
  if (type === 'tree') original = scene.getObjectByName('farm-tree-2');
  else if (type === 'coop') original = scene.getObjectByName('farm-ramp-coop-1');
  else if (type === 'fence') original = createPlacementVisual('fence');
  else if (type === 'tread') original = createStoneStairs(new THREE.Group(), 16, GROUND_HEIGHT, 0).treads[0];
  else throw new Error(`Unknown signed fixture: ${type}`);
  const copy = original.clone(true);
  copy.position.set(0, 0, 0);
  copy.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(copy);
  const center = box.getCenter(new THREE.Vector3());
  copy.position.set(-center.x, -box.min.y, -center.z);
  const group = new THREE.Group();
  group.add(copy);
  return group;
}
const subject = signedType ? signedSubject(signedType) : buildRecipe(recipe);
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
  const target = new THREE.Vector3(0, GROUND_HEIGHT + 0.7, 0);
  const angle = yaw * Math.PI / 180;
  camera.position.copy(target).add(new THREE.Vector3(Math.sin(angle) * Math.sqrt(288), 12, Math.cos(angle) * Math.sqrt(288)));
  camera.lookAt(target);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const lightPhase = phase === 'night-rain' ? 'night' : phase;
  lighting.setDayNightPhase(lightPhase);
  weather.setWeather(phase === 'night-rain' ? 'rain' : 'clear');
  weather.update(2);
  // Test-only fault injection: reverse the existing key; never add a light.
  if (window.__assetForgeWrongKey) scene.getObjectByName('day-night-directional').position.multiplyScalar(-1);
  setRecipeNightAmount(subject, lightPhase === 'night' ? 1 : 0);
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
  let count = 0, contrast = 0, deltaESum = 0, hueSum = 0, hueCount = 0, blownHighlights = 0;
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
    if (a[i] >= 250 && a[i + 1] >= 250 && a[i + 2] >= 250) blownHighlights++;
    const l1 = luminanceRGB(a[i], a[i + 1], a[i + 2]), l2 = luminanceRGB(b[i], b[i + 1], b[i + 2]);
    contrast += (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    deltaESum += deltaE76([a[i], a[i + 1], a[i + 2]], [b[i], b[i + 1], b[i + 2]]);
    const h1 = hue(a[i], a[i + 1], a[i + 2]), h2 = hue(b[i], b[i + 1], b[i + 2]);
    if (h1 !== null && h2 !== null) { const h = Math.abs(h1 - h2); hueSum += Math.min(h, 360 - h); hueCount++; }
    if (withLightingSamples) {
      ray.setFromCamera(new THREE.Vector2((x + 0.5) / width * 2 - 1, (y + 0.5) / height * 2 - 1), camera);
      const hit = ray.intersectObject(subject, true)[0];
      if (hit?.face) {
        const normal = hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
        const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex || 0] : hit.object.material;
        const color = material?.color;
        if (!color) continue;
        const albedo = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
        lightingSamples.push({ normal: normal.toArray(), luminance: l1, albedo });
      }
    }
  }
  return { pixels: count, widthPixels: count ? maxX - minX + 1 : 0, heightPixels: count ? maxY - minY + 1 : 0,
    meanContrastRatio: count ? contrast / count : 0, meanDeltaE: count ? deltaESum / count : 0,
    meanHueDifference: hueCount ? hueSum / hueCount : 0, blownHighlights, lightingSamples };
}

function capture(yaw, phase, surface, delta, featureIds) {
  setView(yaw, phase, surface);
  const present = pixels();
  const image = png(present);
  subject.visible = false; composer.render();
  const absent = pixels();
  subject.visible = true; composer.render();
  const measured = difference(present, absent, delta, surface === 'grass');
  const identities = {};
  const identityParts = {};
  if (surface === 'grass') for (const feature of featureIds) {
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
  const key = scene.getObjectByName('day-night-directional').position.clone().normalize();
  if (window.__assetForgeWrongKey) key.negate();
  return { image, measured, identities, identityParts, keyDirection: key.toArray() };
}

function silhouette(yaw, surface, straight = false) {
  setView(yaw, 'daytime', surface);
  const savedBackground = scene.background, savedFog = scene.fog;
  if (straight) {
    island.visible = false;
    scene.background = new THREE.Color(surface === 'path' ? FARM_PALETTE.dirt : FARM_PALETTE.grass);
    scene.fog = null;
    const target = new THREE.Vector3(0, GROUND_HEIGHT + 0.7, 0);
    camera.position.copy(target).add(yaw === 0 ? new THREE.Vector3(0, 0, 18) : new THREE.Vector3(18, 0, 0));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
  }
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const saved = [];
  subject.traverse((object) => {
    if (object.isMesh) { saved.push([object, object.material]); object.material = black; }
  });
  composer.render();
  const image = png(pixels());
  for (const [object, material] of saved) object.material = material;
  black.dispose();
  scene.background = savedBackground; scene.fog = savedFog;
  setView(yaw, 'daytime', surface);
  return image;
}

function jitter(yaw, delta = 24) {
  setView(yaw, 'daytime', 'grass');
  const before = pixels();
  subject.visible = false; composer.render(); const background = pixels();
  subject.visible = true; composer.render();
  camera.position.x += 0.001;
  camera.updateMatrixWorld(true);
  composer.render();
  const after = pixels();
  const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
  let checked = 0, changed = 0, skippedEdgePixels = 0;
  const examples = [];
  const diff = (a, ai, b, bi) => Math.max(Math.abs(a[ai] - b[bi]), Math.abs(a[ai + 1] - b[bi + 1]), Math.abs(a[ai + 2] - b[bi + 2]));
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = (y * width + x) * 4;
    if (diff(before, i, background, i) < 8) continue;
    // A subpixel camera move naturally changes antialiasing at a silhouette
    // edge. Only classify pixels with a full foreground neighbourhood as
    // flicker; count excluded edges instead of silently treating them as clean.
    let interior = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = ((y + dy) * width + x + dx) * 4;
      if (diff(before, n, background, n) < 8) interior = false;
    }
    if (!interior) { skippedEdgePixels++; continue; }
    checked++;
    if (diff(before, i, after, i) < delta) continue;
    let matchesNearby = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (diff(before, ((y + dy) * width + x + dx) * 4, after, i) < delta) matchesNearby = true;
    }
    if (!matchesNearby) {
      changed++;
      if (examples.length < 12) examples.push({ x, y, before: Array.from(before.subarray(i, i + 3)), after: Array.from(after.subarray(i, i + 3)),
        neighbours: [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => Array.from(before.subarray(((y + dy) * width + x + dx) * 4, ((y + dy) * width + x + dx) * 4 + 3)))) });
    }
  }
  return { yaw, checkedPixels: checked, skippedEdgePixels, flickerCandidates: changed, examples,
    beforeImage: png(before), afterImage: png(after) };
}

function transparentReference(yaw, zoom) {
  setView(yaw, 'daytime', 'grass');
  const previousBackground = scene.background;
  const previousFrustum = [camera.left, camera.right, camera.top, camera.bottom, camera.zoom];
  const previousPosition = camera.position.clone(), previousQuaternion = camera.quaternion.clone();
  island.visible = false;
  scene.background = null;
  const center = new THREE.Box3().setFromObject(subject).getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(12, 12, 12);
  camera.position.copy(center).add(direction);
  camera.lookAt(center);
  camera.left = -10; camera.right = 10; camera.top = 10; camera.bottom = -10; camera.zoom = zoom;
  camera.updateProjectionMatrix();
  const canvas = document.createElement('canvas');
  const preview = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  preview.setClearColor(0x000000, 0);
  preview.setPixelRatio(1);
  preview.setSize(640, 640, false);
  preview.render(scene, camera);
  const image = canvas.toDataURL('image/png').split(',')[1];
  preview.dispose();
  scene.background = previousBackground;
  [camera.left, camera.right, camera.top, camera.bottom, camera.zoom] = previousFrustum;
  camera.position.copy(previousPosition); camera.quaternion.copy(previousQuaternion);
  camera.updateProjectionMatrix();
  island.visible = true;
  composer.render();
  return image;
}

window.__assetForge = {
  capture,
  silhouette,
  jitter,
  transparentReference,
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
