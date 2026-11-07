import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFireflies } = await vite.ssrLoadModule('/src/effects/createFireflies.ts');
const { createVisualRandom } = await vite.ssrLoadModule('/src/effects/createVisualRandom.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createFarmLayout, FARM_LAYOUT } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { WATER_FEATURE } = await vite.ssrLoadModule('/src/content/waterFeature.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { GROUND_HEIGHT } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

function fixture(t, seed = 123) {
  const scene = new THREE.Scene();
  const { windows, extraEmissives } = createFarmLayout(scene);
  const character = new THREE.Group();
  scene.add(character);
  const cycle = createDayNightCycle({ scene, character, windows, extraEmissives });
  const { camera, resize } = createIsometricCamera();
  resize(1280, 720);
  let lightsBefore = 0;
  scene.traverse((object) => { if (object.isLight) lightsBefore++; });
  const fireflies = createFireflies({ scene, camera, groundHeight: GROUND_HEIGHT, random: createVisualRandom(seed) });
  t.after(fireflies.dispose);
  const mesh = scene.getObjectByName('night-fireflies');
  return { scene, cycle, camera, fireflies, mesh, lightsBefore };
}

const opacities = (mesh) => Array.from(mesh.geometry.getAttribute('instanceOpacity').array);
const active = (mesh) => mesh.visible ? opacities(mesh).filter((value) => value > 0).length : 0;
function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}
function positions(mesh) {
  const matrix = new THREE.Matrix4();
  return Array.from({ length: mesh.count }, (_, index) => {
    mesh.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });
}

test('night weather counts are 14 clear, 10 cloudy and 6 rain; other phase anchors have none', (t) => {
  const { cycle, fireflies, mesh } = fixture(t);
  for (const phase of ['morning', 'daytime', 'sunset', 'night']) {
    cycle.setDayNightPhase(phase);
    for (const [rain, cloudy, expected] of [[0, 0, 14], [0, 1, 10], [1, 0, 6]]) {
      fireflies.update(0, cycle.getNightAmount(), rain, cloudy);
      assert.equal(active(mesh), phase === 'night' ? expected : 0, `${phase}, ${rain}, ${cloudy}`);
    }
  }
  cycle.setDayNightPhase('sunset');
  cycle.update(9);
  near(cycle.getNightAmount(), 0.5);
  fireflies.update(0, cycle.getNightAmount(), 0, 0);
  const halfway = opacities(mesh);
  fireflies.update(0, 1, 0, 0);
  opacities(mesh).forEach((value, index) => near(halfway[index], value / 2));
});

test('the single unlit draw contains exact-size yellow quads and adds no lights', (t) => {
  const { scene, fireflies, mesh, lightsBefore } = fixture(t);
  fireflies.update(0, 1, 0, 0);
  assert.equal(mesh.isInstancedMesh, true);
  assert.equal(mesh.count, 14);
  assert.equal(mesh.geometry.parameters.width, 0.22);
  assert.equal(mesh.geometry.parameters.height, 0.22);
  assert.equal(mesh.material.isShaderMaterial, true);
  assert.equal(mesh.material.uniforms.coreColor.value.getHex(), 0xf2e27a);
  assert.equal(mesh.material.depthWrite, false);
  let lightsAfter = 0;
  scene.traverse((object) => { if (object.isLight) lightsAfter++; });
  assert.equal(lightsAfter, lightsBefore);
  assert.throws(() => fireflies.update(-1, 1, 0, 0), RangeError);
  assert.throws(() => fireflies.update(0, 1, 0.8, 0.8), RangeError);
});

test('phase and weather crossfades preserve motion and reduce rainy survivors to 60%', (t) => {
  const { fireflies, mesh } = fixture(t);
  fireflies.update(0, 1, 0, 0);
  const clear = opacities(mesh);
  const before = positions(mesh);
  fireflies.update(0, 1, 0.5, 0.5);
  const mixed = opacities(mesh);
  for (let i = 0; i < 6; i++) near(mixed[i], clear[i] * 0.8);
  for (let i = 6; i < 10; i++) near(mixed[i], clear[i] * 0.8 * 0.5);
  for (let i = 10; i < 14; i++) near(mixed[i], 0);
  assert.deepEqual(positions(mesh), before);
  fireflies.update(0, 1, 1, 0);
  const rain = opacities(mesh);
  for (let i = 0; i < 6; i++) near(rain[i], clear[i] * 0.6);
  assert.ok(rain.slice(6).every((value) => value === 0));
  fireflies.update(0, 1, 0, 0);
  assert.deepEqual(opacities(mesh), clear);
});

test('independent seeded pulses stay within 0.25–1 and repeat in 2.5–4.5 seconds', (t) => {
  const { fireflies, mesh } = fixture(t);
  const samples = Array.from({ length: 14 }, () => []);
  for (let frame = 0; frame <= 1000; frame++) {
    fireflies.update(frame ? 0.01 : 0, 1, 0, 0);
    opacities(mesh).forEach((value, index) => samples[index].push(value));
  }
  assert.ok(new Set(samples.map((values) => values[0].toFixed(4))).size > 10, 'phases should differ');
  for (const values of samples) {
    assert.ok(Math.min(...values) >= 0.25 - 1e-6 && Math.min(...values) < 0.251);
    assert.ok(Math.max(...values) <= 1 + 1e-6 && Math.max(...values) > 0.999);
    const peaks = [];
    for (let i = 1; i < values.length - 1; i++) {
      if (values[i] > values[i - 1] && values[i] >= values[i + 1]) peaks.push(i * 0.01);
    }
    assert.ok(peaks.length >= 2);
    for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] - peaks[i - 1] >= 2.49 && peaks[i] - peaks[i - 1] <= 4.51);
  }
});

test('Lissajous loops stay low, bounded and away from roofs, island edge and stairs', (t) => {
  const { scene, fireflies, mesh } = fixture(t);
  scene.updateMatrixWorld(true);
  const roofs = ['cottage-roof', 'ramp-coop-1-roof', 'ramp-coop-2-roof']
    .map((name) => new THREE.Box3().setFromObject(scene.getObjectByName(name)));
  const bounds = Array.from({ length: 14 }, () => ({ minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }));
  let previous;
  for (let frame = 0; frame <= 600; frame++) {
    fireflies.update(frame ? 0.2 : 0, 1, 0, 0);
    const current = positions(mesh);
    for (let i = 0; i < current.length; i++) {
      const p = current[i];
      assert.ok(p.y - GROUND_HEIGHT >= 0.5 && p.y - GROUND_HEIGHT <= 1.6);
      assert.ok(Math.abs(p.x) + 0.11 < 8 && Math.abs(p.z) + 0.11 < 8, 'mote reached the void');
      assert.ok(!(p.x > 7.5 && Math.abs(p.z - 0.75) < 1.5), 'mote reached the stair rim');
      for (const [roofIndex, roof] of roofs.entries()) {
        assert.ok(!(p.x >= roof.min.x - 0.11 && p.x <= roof.max.x + 0.11 &&
          p.z >= roof.min.z - 0.11 && p.z <= roof.max.z + 0.11),
        `mote ${i} entered roof ${roofIndex}: ${p.toArray()} vs ${roof.min.toArray()}..${roof.max.toArray()}`);
      }
      if (previous) {
        const speed = p.distanceTo(previous[i]) / 0.2;
        assert.ok(speed >= 0.15 - 1e-4 && speed <= 0.35 + 1e-4, `speed ${speed}`);
      }
      const b = bounds[i];
      b.minX = Math.min(b.minX, p.x); b.maxX = Math.max(b.maxX, p.x);
      b.minZ = Math.min(b.minZ, p.z); b.maxZ = Math.max(b.maxZ, p.z);
    }
    previous = current;
  }
  const stream = new THREE.CatmullRomCurve3(WATER_FEATURE.stream.points.map(([x, z]) => new THREE.Vector3(x, 0, z)))
    .getSpacedPoints(400);
  const pond = FARM_LAYOUT.pond;
  for (const b of bounds) {
    const radiusX = (b.maxX - b.minX) / 2;
    const radiusZ = (b.maxZ - b.minZ) / 2;
    assert.ok(radiusX >= 0.5 - 1e-3 && radiusX <= 1.2 + 1e-3);
    near(radiusX, radiusZ, 1e-3);
    assert.ok(Math.hypot(radiusX, 0.12) <= 1.2, 'vertical bob exceeded the 3-D loop radius');
    const homeX = (b.minX + b.maxX) / 2;
    const homeZ = (b.minZ + b.maxZ) / 2;
    assert.ok(stream.every((p) => Math.hypot(p.x - homeX, p.z - homeZ) > WATER_FEATURE.stream.rimWidth / 2 - 0.01),
      'home is not on grass beside the stream');
    assert.ok(Math.hypot((homeX - pond.x) / (pond.width / 2), (homeZ - pond.z) / (pond.depth / 2)) > 1.05,
      'home is inside the pond rim');
  }
});

test('the full quad stays over the island in the fixed isometric view across seeds', (t) => {
  // Project a mote onto the ground along the camera's fixed (12, 12, 12)
  // viewing direction. The 0.4-unit margin includes the entire billboard
  // and a pixel-pass sampling margin, not just its centre in world space.
  for (const seed of [0, 1, 0xffffffff, 0x464c4945, 0xad3f4944]) {
    const { fireflies, mesh } = fixture(t, seed);
    for (let frame = 0; frame <= 240; frame++) {
      fireflies.update(frame ? 0.5 : 0, 1, 0, 0);
      for (const p of positions(mesh)) {
        const height = p.y - GROUND_HEIGHT;
        assert.ok(Math.abs(p.x - height) < 7.6 && Math.abs(p.z - height) < 7.6,
          `seed ${seed}: ${p.toArray()} projects over the void`);
      }
    }
  }
});

test('injected seeds reproduce the whole effect without influencing the lights', (t) => {
  const a = fixture(t, 0xeb730001);
  const b = fixture(t, 0xeb730001);
  const different = fixture(t, 0xeb730002);
  for (const delta of [0, 0.1, 1.8, 0.4, 3.2]) {
    for (const item of [a, b, different]) item.fireflies.update(delta, 0.8, 0.25, 0.5);
    assert.deepEqual(positions(a.mesh), positions(b.mesh));
    assert.deepEqual(opacities(a.mesh), opacities(b.mesh));
  }
  assert.notDeepEqual(positions(a.mesh), positions(different.mesh));
  a.fireflies.dispose();
  assert.equal(a.scene.getObjectByName('night-fireflies'), undefined);
});
