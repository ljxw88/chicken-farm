import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createIsland } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createFarmDecorations } = await vite.ssrLoadModule('/src/render/farmDecorations.ts');
const { createFarmShadows } = await vite.ssrLoadModule('/src/scene/createFarmShadows.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
after(() => vite.close());

function fixture() {
  const scene = new THREE.Scene();
  createIsland(scene);
  const character = createCharacter();
  character.position.y = 2.4;
  scene.add(character);
  const { windows, extraEmissives } = createFarmLayout(scene);
  createFarmDecorations(scene, 2.4);
  createFarmShadows(scene);
  createDayNightCycle({ scene, character, windows, extraEmissives });
  scene.updateMatrixWorld(true);
  return scene;
}

function triangles(geometry, visit) {
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  if (!positions || !normals) return;
  const index = geometry.getIndex();
  const count = index ? index.count : positions.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const ids = [0, 1, 2].map((offset) => index ? index.getX(i + offset) : i + offset);
    const [a, b, c] = ids.map((id) => new THREE.Vector3().fromBufferAttribute(positions, id));
    const face = b.sub(a).cross(c.sub(a));
    if (face.lengthSq() < 1e-14) continue; // Sphere poles and clipped path end.
    const average = ids.reduce((sum, id) => sum.add(new THREE.Vector3().fromBufferAttribute(normals, id)), new THREE.Vector3());
    if (average.lengthSq() < 1e-14) continue;
    visit(face.normalize(), average.normalize(), i / 3);
  }
}

test('nondegenerate path faces and their normals point upward through the tight bend', () => {
  const scene = fixture();
  for (const name of ['farm-path-edge', 'farm-path-surface']) {
    let count = 0;
    triangles(scene.getObjectByName(name).geometry, (face, normal, triangle) => {
      count++;
      assert.ok(face.y > 0.999 && normal.y > 0.999, `${name} triangle ${triangle} faces down`);
    });
    assert.ok(count > 300, `${name} did not contain the expected path`);
  }
});

test('character, buildings and props have consistent face/vertex winding and no mirrored transforms', () => {
  const scene = fixture();
  const geometries = new Set();
  let checked = 0;
  scene.traverse((object) => {
    if (!object.isMesh) return;
    assert.ok(object.matrixWorld.determinant() > 0, `${object.name || object.type} is mirrored`);
    const geometry = object.geometry;
    if (geometries.has(geometry)) return;
    geometries.add(geometry);
    triangles(geometry, (face, normal, triangle) => {
      checked++;
      assert.ok(face.dot(normal) >= -1e-4, `${object.name || geometry.type} triangle ${triangle} disagrees with its normals`);
    });
  });
  assert.ok(checked > 5000, `Only ${checked} triangles were checked`);
});
