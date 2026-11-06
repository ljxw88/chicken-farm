import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createFarmDecorations } = await vite.ssrLoadModule('/src/scene/createFarmDecorations.ts');
const { WATER_FEATURE } = await vite.ssrLoadModule('/src/scene/waterFeatureSpec.ts');
const { moveWithFarmCollisions } = await vite.ssrLoadModule('/src/character/farmCollisions.ts');
const { createGrid, intersectsFootprint, TILE_SIZE } = await vite.ssrLoadModule('/src/placement/grid.ts');
const { createPlacement } = await vite.ssrLoadModule('/src/placement/createPlacement.ts');
const { createCharacter } = await vite.ssrLoadModule('/src/character/createCharacter.ts');
const { createDayNightCycle } = await vite.ssrLoadModule('/src/lighting/createDayNightCycle.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createRainEffect } = await vite.ssrLoadModule('/src/weather/createRainEffect.ts');
const { createIsland, GROUND_HEIGHT } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
after(() => vite.close());

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function fixture() {
  const scene = new THREE.Scene();
  const layout = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  return { scene, ...layout };
}

function box(scene, name) {
  const object = scene.getObjectByName(name);
  assert.ok(object, name);
  return new THREE.Box3().setFromObject(object);
}

// Horizontal distance between convex projected footprints, including triangles
// from the actual ribbon meshes rather than centreline approximations.
function footprintDistance(a, b) {
  const separated = [a, b].some((polygon) => polygon.some((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const nx = next.z - point.z;
    const nz = point.x - next.x;
    if (nx * nx + nz * nz < 1e-16) return false;
    const pa = a.map((p) => p.x * nx + p.z * nz);
    const pb = b.map((p) => p.x * nx + p.z * nz);
    return Math.max(...pa) < Math.min(...pb) - 1e-9 || Math.max(...pb) < Math.min(...pa) - 1e-9;
  }));
  if (!separated) return 0;
  function pointToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = dx * dx + dz * dz;
    const t = length ? THREE.MathUtils.clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / length, 0, 1) : 0;
    return Math.hypot(point.x - start.x - t * dx, point.z - start.z - t * dz);
  }
  let distance = Infinity;
  for (const [points, edges] of [[a, b], [b, a]]) for (const point of points) {
    for (let i = 0; i < edges.length; i++) distance = Math.min(distance, pointToSegment(point, edges[i], edges[(i + 1) % edges.length]));
  }
  return distance;
}

function boxFootprint(bounds) {
  return [
    { x: bounds.min.x, z: bounds.min.z }, { x: bounds.max.x, z: bounds.min.z },
    { x: bounds.max.x, z: bounds.max.z }, { x: bounds.min.x, z: bounds.max.z },
  ];
}

function ribbonDistance(mesh, footprint) {
  const positions = mesh.geometry.attributes.position;
  const indices = mesh.geometry.index;
  let distance = Infinity;
  for (let i = 0; i < indices.count; i += 3) {
    const triangle = [0, 1, 2].map((offset) => {
      const point = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + offset)));
      return { x: point.x, z: point.z };
    });
    distance = Math.min(distance, footprintDistance(footprint, triangle));
  }
  return distance;
}

test('the locked Catmull-Rom route, widths, layered elevations and water palette are exact', () => {
  assert.deepEqual(WATER_FEATURE.stream.points, [
    [3.9, -2.45], [3.9, -1.95], [3.6, -0.8], [3.1, 0.6], [2.85, 2],
    [2.9, 3.6], [3.25, 5.3], [3.55, 6.8], [3.6, 8],
  ]);
  const { scene } = fixture();
  const lockedCurve = new THREE.CatmullRomCurve3(WATER_FEATURE.stream.points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  for (const [name, width, lift, color] of [
    ['farm-stream-rim', 1.5, 0.027, 0x7aadb8],
    ['farm-stream-water', 1.2, 0.029, 0x5b8fa8],
    ['farm-stream-deep', 0.35, 0.030, 0x3a6a7a],
  ]) {
    const mesh = scene.getObjectByName(name);
    assert.equal(mesh.material.color.getHex(), color);
    const vertices = mesh.geometry.attributes.position;
    for (let i = 0; i < vertices.count - 2; i += 2) { // Last pair is clipped to the island rim.
      near(Math.hypot(vertices.getX(i) - vertices.getX(i + 1), vertices.getZ(i) - vertices.getZ(i + 1)), width, 2e-6);
      near(vertices.getY(i), GROUND_HEIGHT + lift, 2e-6);
      if (name !== 'farm-stream-deep' && i % 40 === 0) {
        const point = lockedCurve.getPointAt(i / (vertices.count - 2));
        near((vertices.getX(i) + vertices.getX(i + 1)) / 2, point.x, 2e-6);
        near((vertices.getZ(i) + vertices.getZ(i + 1)) / 2, point.z, 2e-6);
      }
    }
  }
  const foam = scene.getObjectByName('farm-water-feature').children.filter((item) => item.name.startsWith('farm-stream-foam-'));
  assert.ok(foam.length >= 10);
  for (const dash of foam) {
    near(dash.geometry.parameters.width, 0.3);
    near(dash.geometry.parameters.height, 0.1);
    near(dash.position.y, GROUND_HEIGHT + 0.032);
    assert.equal(dash.material.color.getHex(), 0xbfe0e6);
  }
});

test('five locked planks, four gap lines and both three-post rails follow the graded deck', () => {
  const { scene, bridgeHeight } = fixture();
  const deck = scene.getObjectByName('farm-wooden-bridge');
  assert.ok(deck);
  near(deck.position.x, 3.9);
  near(deck.position.z, -1.95);
  for (let i = 1; i <= 5; i++) {
    const plank = scene.getObjectByName(`bridge-plank-${i}`);
    const bounds = box(scene, `bridge-plank-${i}`);
    near(bounds.max.x - bounds.min.x, 0.4);
    near(bounds.min.x, 2.9 + (i - 1) * 0.4);
    near(bounds.min.z, -2.65);
    near(bounds.max.z, -1.25);
    assert.equal(plank.material.color.getHex(), 0xc8956c);
  }
  for (let i = 1; i <= 4; i++) {
    const gap = scene.getObjectByName(`bridge-gap-${i}`);
    near(box(scene, `bridge-gap-${i}`).max.x - box(scene, `bridge-gap-${i}`).min.x, 0.04);
    assert.equal(gap.material.color.getHex(), 0x7a5a3a);
  }
  assert.equal(scene.getObjectByName('bridge-underside').material.color.getHex(), 0x7a5a3a);
  for (const side of ['north', 'south']) {
    const rail = scene.getObjectByName(`bridge-rail-${side}`);
    assert.equal(rail.material.color.getHex(), 0x8b5e3c);
    for (let i = 1; i <= 3; i++) {
      const post = scene.getObjectByName(`bridge-post-${side}-${i}`);
      near(post.geometry.parameters.width, 0.14);
      near(post.geometry.parameters.depth, 0.14);
      near(post.geometry.parameters.height, 0.55);
      assert.equal(post.material.color.getHex(), 0x8b5e3c);
    }
  }
  const ray = new THREE.Raycaster();
  for (const [x, lift] of [[2.91, 0.004], [3.05, 0.06], [3.2, 0.12], [3.9, 0.12], [4.6, 0.12], [4.75, 0.06], [4.89, 0.004]]) {
    near(bridgeHeight(x, -1.95), GROUND_HEIGHT + lift);
    ray.set(new THREE.Vector3(x, 10, -1.95), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(deck, true)[0];
    assert.ok(hit, `no board at ${x}`);
    near(hit.point.y, GROUND_HEIGHT + lift, 2e-5);
  }
  assert.equal(bridgeHeight(2.8, -1.95), undefined);
  assert.equal(bridgeHeight(3.9, -1.2), undefined);
});

test('the character capsule follows both grades continuously without clipping the visible planks', () => {
  const { scene, bridgeHeight } = fixture();
  const bridge = scene.getObjectByName('farm-wooden-bridge');
  const ray = new THREE.Raycaster();
  const tops = [];
  for (let q = 2.905; q < 4.9; q += 0.01) {
    if ([3.3, 3.7, 4.1, 4.5].some((gap) => Math.abs(q - gap) < 0.021)) continue;
    ray.set(new THREE.Vector3(q, 10, -1.95), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(bridge, true)[0];
    assert.ok(hit);
    tops.push({ x: q, y: hit.point.y });
  }
  let previous;
  for (let x = 2.5; x <= 5.3; x += 0.01) {
    const feet = bridgeHeight(x, -1.95, 0.4) ?? GROUND_HEIGHT;
    assert.ok(feet >= GROUND_HEIGHT && feet <= GROUND_HEIGHT + 0.12 + 1e-8);
    if (previous !== undefined) assert.ok(Math.abs(feet - previous) <= 0.00401, `vertical step at x=${x}`);
    previous = feet;
    for (const point of tops) {
      if (Math.abs(point.x - x) > 0.4) continue;
      const distance = Math.hypot(point.x - x, point.y - (feet + 0.4));
      assert.ok(distance >= 0.4 - 1e-5, `capsule intersects the deck at x=${x}, sample=${point.x}`);
    }
  }
});

test('water boxes block the stream, the deck is crossable, and both sides stop the character', () => {
  const { scene, obstacles } = fixture();
  const water = obstacles.filter((entry) => entry.name.startsWith('stream-water-'));
  const bridge = obstacles.find((entry) => entry.name === 'wooden-bridge');
  const pond = obstacles.find((entry) => entry.name === 'pond');
  assert.ok(water.length > 10 && water.every((entry) => entry.kind === 'box'));
  assert.deepEqual(bridge, { kind: 'box', name: 'wooden-bridge', blocksWalking: false,
    minX: 2.9, maxX: 4.9, minZ: -2.65, maxZ: -1.25 });
  near(pond.minX, 2.3725);
  near(pond.maxX, 5.6275);
  near(pond.minZ, -4.4975);
  near(pond.maxZ, -2.5025);
  for (const entry of water) {
    const overlap = entry.minX < bridge.maxX && entry.maxX > bridge.minX &&
      entry.minZ < bridge.maxZ && entry.maxZ > bridge.minZ;
    assert.equal(overlap, false, `${entry.name} enters the deck gap`);
  }
  const rendered = scene.getObjectByName('farm-stream-water').geometry.attributes.position;
  for (let i = 0; i < rendered.count; i++) {
    const x = rendered.getX(i);
    const z = rendered.getZ(i);
    const contains = (entry) => x >= entry.minX - 1e-5 && x <= entry.maxX + 1e-5 &&
      z >= entry.minZ - 1e-5 && z <= entry.maxZ + 1e-5;
    assert.ok(contains(bridge) || contains(pond) || water.some(contains), `unblocked water edge at ${x}, ${z}`);
  }
  for (const direction of [-1, 1]) {
    const result = moveWithFarmCollisions(3.9 - direction * 1.8, -1.95, direction * 3.6, 0, 0.4, obstacles);
    near(result.x, 3.9 + direction * 1.8);
    near(result.z, -1.95);
  }
  const stream = moveWithFarmCollisions(1, 3.6, 5, 0, 0.4, obstacles);
  assert.ok(stream.x > 1 && stream.x < 2.2, `crossed the stream at ${stream.x}`);
  const south = moveWithFarmCollisions(3.9, -1.95, 0, 2, 0.4, obstacles);
  assert.ok(south.z < -1.65 && south.z > -1.85, `stepped off the bridge: ${south.z}`);
  const north = moveWithFarmCollisions(3.9, -1.95, 0, -2, 0.4, obstacles);
  assert.ok(north.z > -2.2 && north.z <= -1.95, `stepped into the pond: ${north.z}`);
});

test('the waterfall rim and neighbouring bank never permit walking into the void', () => {
  const scene = new THREE.Scene();
  const { stairs } = createIsland(scene);
  const { obstacles } = createFarmLayout(scene);
  const bank = moveWithFarmCollisions(4.8, 7, 0, 3, 0.4, obstacles, stairs.bounds, stairs.supports, stairs.slidePadCorner);
  near(bank.z, 7.6, 1e-6);
  assert.ok(stairs.supports(bank.x, bank.z, 0.4));
  const water = moveWithFarmCollisions(5.2, 7.2, -2, 1, 0.4, obstacles, stairs.bounds, stairs.supports, stairs.slidePadCorner);
  assert.ok(water.z <= 7.6 && stairs.supports(water.x, water.z, 0.4));
  assert.ok(water.x > 4.2, `crossed the water at the waterfall: ${water.x}`);
});

test('all 1.5-unit fence and plot footprints overlapping water or the full deck are reserved', () => {
  const { obstacles } = fixture();
  const bridge = obstacles.find((entry) => entry.name === 'wooden-bridge');
  const water = obstacles.filter((entry) => entry.name.startsWith('stream-water-'));
  const grid = createGrid(16);
  assert.equal(TILE_SIZE, 1.5);
  let deckTiles = 0;
  for (let column = 0; column < grid.count; column++) for (let row = 0; row < grid.count; row++) {
    for (const kind of ['fence', 'plot']) for (let rotation = 0; rotation < 4; rotation++) {
      const area = grid.footprint({ column, row }, kind, rotation);
      if (!grid.contains(area)) continue;
      const actualOverlap = area.minX < 4.9 && area.maxX > 2.9 && area.minZ < -1.25 && area.maxZ > -2.65;
      assert.equal(intersectsFootprint(area, bridge), actualOverlap, `${kind} ${column},${row}/${rotation}`);
      if (actualOverlap) deckTiles++;
    }
  }
  assert.ok(deckTiles > 20, 'the whole deck must reserve every overlapping candidate');
  assert.ok(water.some((entry) => intersectsFootprint(grid.footprint(grid.cellAt(2.25, 3.75), 'fence', 0), entry)));
  assert.equal(intersectsFootprint(grid.footprint(grid.cellAt(-6.75, 6.75), 'fence', 0), bridge), false);
});

test('stream and full deck exclude actual rain splashes, including the water beneath the bridge', () => {
  const { scene, splashExclusions } = fixture();
  const stream = splashExclusions.filter((entry) => entry.name.startsWith('stream-water-'));
  const deck = splashExclusions.find((entry) => entry.name === 'wooden-bridge');
  assert.ok(stream.length >= 10);
  for (const entry of stream) near(entry.maxX - entry.minX, 1.26);
  assert.ok(deck && deck.blocksWalking === false);
  assert.ok(stream.some((entry) => entry.minX < 3.9 && entry.maxX > 3.9 && entry.minZ < -1.95 && entry.maxZ > -1.95),
    'uncut stream must also be a rain exclusion');
  const { camera, resize } = createIsometricCamera();
  resize(1280, 720);

  function impactsAt(x, z, exclusions) {
    const rainScene = new THREE.Scene();
    const anchor = new THREE.Group();
    anchor.position.set(x, GROUND_HEIGHT, z);
    rainScene.add(anchor);
    let call = 0;
    // Put every initial streak at the anchor with y=0; subsequent random=0
    // forces impact attempts, so an empty result proves the keep-out is used.
    const random = () => call++ < 240 * 5 ? [0.5, 0, 0.5, 0.5, 0.5][(call - 1) % 5] : 0;
    const effect = createRainEffect({ scene: rainScene, camera, anchor, groundHeight: GROUND_HEIGHT,
      groundSize: 16, splashExclusions: exclusions, random });
    effect.update(0.01, 1);
    const count = rainScene.children.filter((child) => child.name === 'weather-rain')[0].children
      .filter((child) => child.name.startsWith('rain-splash-') && child.visible).length;
    effect.dispose();
    return count;
  }
  assert.ok(impactsAt(2.9, 3.6, []) > 0, 'control impacts must actually spawn');
  assert.equal(impactsAt(2.9, 3.6, splashExclusions), 0);
  assert.ok(impactsAt(3.9, -1.95, []) > 0);
  assert.equal(impactsAt(3.9, -1.95, splashExclusions), 0);
  assert.ok(scene.getObjectByName('farm-wooden-bridge'));
});

test('waterfall face, 0.8-unit alpha fade, foam lip and stepped 0.25-unit/s streaks match the lock', () => {
  const { scene, updateWaterfall } = fixture();
  const face = scene.getObjectByName('farm-waterfall-face');
  const lip = scene.getObjectByName('farm-waterfall-lip');
  const streaks = scene.getObjectByName('farm-waterfall-streaks');
  near(face.position.x, 3.6);
  near(face.position.z, 8.06);
  const position = face.geometry.attributes.position;
  const color = face.geometry.attributes.color;
  assert.equal(color.itemSize, 4);
  near(position.getX(0), -0.6);
  near(position.getX(1), 0.6);
  near(position.getY(0), 2.4, 1e-6);
  near(position.getY(2), -0.4, 1e-6);
  near(position.getY(4), -1.2, 1e-6);
  near(color.getW(0), 1);
  near(color.getW(2), 1);
  near(color.getW(4), 0);
  const topColor = new THREE.Color(0x5b8fa8);
  const bottomColor = new THREE.Color(0x8fc1cf);
  for (const [index, expected] of [[0, topColor], [4, bottomColor]]) {
    near(color.getX(index), expected.r, 1e-6);
    near(color.getY(index), expected.g, 1e-6);
    near(color.getZ(index), expected.b, 1e-6);
  }
  assert.equal(face.material.transparent, true);
  assert.equal(face.material.emissive.getHex(), 0);
  near(lip.geometry.parameters.width, 1.2);
  near(lip.geometry.parameters.height, 0.2);
  near(lip.position.z, 7.9);
  assert.equal(lip.material.color.getHex(), 0xbfe0e6);
  assert.equal(streaks.material.color.getHex(), 0xddeff2);
  const initial = Array.from(streaks.geometry.attributes.position.array);
  updateWaterfall(0.399);
  assert.deepEqual(Array.from(streaks.geometry.attributes.position.array), initial);
  updateWaterfall(0.001); // 0.25 units/s advances 0.1 after 0.4 s.
  const advanced = Array.from(streaks.geometry.attributes.position.array);
  assert.notDeepEqual(advanced, initial);
  near(advanced[4], initial[4] - 0.1, 1e-6);
  updateWaterfall(3.6); // Four seconds = one full 1-unit pattern repeat.
  const repeated = Array.from(streaks.geometry.attributes.position.array);
  assert.equal(repeated.length, initial.length);
  repeated.forEach((value, index) => near(value, initial[index], 1e-6));
  const xs = initial.filter((_, index) => index % 3 === 0);
  for (const center of [-0.45, -0.15, 0.15, 0.45]) {
    assert.ok(xs.some((x) => Math.abs(x - (center - 0.06)) < 1e-6));
    assert.ok(xs.some((x) => Math.abs(x - (center + 0.06)) < 1e-6));
  }
});

test('only the two locked grass tufts are hidden; all other instance transforms stay in place', () => {
  const { scene } = fixture();
  const tufts = scene.getObjectByName('farm-grass-tufts');
  assert.equal(tufts.count, 72);
  const centers = [
    [-6.2, 2.5], [-3.8, 2.65], [-2.6, 3.1], [-0.8, 2.8], [1, 3.4], [3.5, 1.5],
    [5.4, 1.3], [6.2, -1.4], [6, -5.7], [2.9, -6.3], [1.3, -6.8], [-2.2, -5.7],
    [-6.5, -4.7], [-7.2, -1.6], [-6.8, 0.9], [-2.9, 0.35], [3, 0.85], [1.9, -4.8],
    [-0.75, -3.8], [4.8, 3.7], [-4.9, 4.4], [7.5, -3.4], [-7.5, 3.8], [0.4, 5],
  ];
  const offsets = [[-0.08, 0, 0.22], [0.07, 0.03, -0.25], [0, -0.08, 0.08]];
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const expected = new THREE.Object3D();
  const hidden = [];
  for (let i = 0; i < tufts.count; i++) {
    tufts.getMatrixAt(i, matrix);
    position.setFromMatrixPosition(matrix);
    const hiddenMatrix = [0, 1, 2, 4, 5, 6, 8, 9, 10].every((index) => matrix.elements[index] === 0);
    if (hiddenMatrix) hidden.push([Number(position.x.toFixed(2)), Number(position.z.toFixed(2))]);
    else {
      const [x, z] = centers[Math.floor(i / 3)];
      const [offsetX, offsetZ, tilt] = offsets[i % 3];
      expected.position.set(x + offsetX, GROUND_HEIGHT + 0.13, z + offsetZ);
      expected.rotation.set(0, i * 0.7, tilt);
      expected.updateMatrix();
      matrix.elements.forEach((value, index) => near(value, expected.matrix.elements[index], 1e-6));
    }
  }
  assert.deepEqual(hidden, [[3.42, 1.5], [3.57, 1.53], [3.5, 1.42], [2.92, 0.85], [3.07, 0.88], [3, 0.77]]);
});

test('measure locked keep-out conflicts and relocated nest clearances', () => {
  const { scene, obstacles } = fixture();
  const decorations = createFarmDecorations(scene, GROUND_HEIGHT);
  const { stairs } = createIsland(scene);
  scene.updateMatrixWorld(true);
  const feature = scene.getObjectByName('farm-water-feature');
  const bounds = new THREE.Box3().setFromObject(feature);
  assert.ok(bounds.max.x <= 5.2 + 1e-6, `new feature reaches x=${bounds.max.x}`);
  const zones = obstacles.filter((entry) => entry.name.startsWith('stream-water-') || entry.name === 'wooden-bridge');
  assert.ok(zones.every((entry) => entry.maxX <= 5.2 + 1e-6), 'a new collision exceeds the stair-side keep-out');
  near(Math.min(...zones.map((entry) => entry.minX)), 2.2054, 0.002);
  // The locked curve itself violates x>=2.9; keep it and report the measured value.
  near(bounds.min.x, 2.082, 0.01);
  assert.ok(bounds.min.x < 2.9);
  const roof = box(scene, 'ramp-coop-2-roof');
  const vertices = scene.getObjectByName('farm-stream-water').geometry.attributes.position;
  let distance = Infinity;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i);
    const z = vertices.getZ(i);
    distance = Math.min(distance, Math.hypot(x - THREE.MathUtils.clamp(x, roof.min.x, roof.max.x),
      z - THREE.MathUtils.clamp(z, roof.min.z, roof.max.z)));
  }
  assert.ok(distance >= 0.8, `stream is only ${distance} from coop B roof`);
  near(distance, 2.067, 0.01);
  const pond = obstacles.find((entry) => entry.name === 'pond');
  // The unchanged pond intrudes into the nominally empty bridge gap by 0.1475.
  near(pond.maxZ - (-2.65), 0.1475);
  const border = scene.getObjectByName('farm-path-edge').geometry.attributes.position;
  const pathOutside = [];
  for (let i = 0; i < border.count; i++) {
    if (border.getX(i) >= 2.9 && border.getX(i) <= 4.9 && border.getZ(i) > -1.25) pathOutside.push(border.getZ(i));
  }
  assert.ok(pathOutside.length, 'locked deck does not fully cover the real path border');
  assert.ok(Math.max(...pathOutside) - (-1.25) > 0.18);
  near(WATER_FEATURE.bridge.gapWidth, 0.04); // Conflicts with the 0.1 minimum feature size.
  const nest = scene.getObjectByName('farm-nest-decoration');
  assert.ok(decorations.includes(nest)); // Placement reads this live object, not a fixed old-position entry.
  near(nest.position.x, 4.3);
  near(nest.position.z, 0.7);
  const nestBounds = new THREE.Box3().setFromObject(nest);
  const placementFootprint = boxFootprint(nestBounds);
  const straw = nest.children.find((child) => child.geometry.type === 'RingGeometry');
  const ring = [];
  const ringPositions = straw.geometry.attributes.position;
  for (let i = 0; i < ringPositions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(ringPositions, i);
    if (Math.abs(Math.hypot(point.x, point.y) - straw.geometry.parameters.outerRadius) > 1e-6) continue;
    straw.localToWorld(point);
    if (!ring.some((other) => Math.hypot(point.x - other.x, point.z - other.z) < 1e-6)) ring.push({ x: point.x, z: point.z });
  }
  ring.sort((a, b) => Math.atan2(a.z - 0.7, a.x - 4.3) - Math.atan2(b.z - 0.7, b.x - 4.3));
  assert.equal(ring.length, 20);
  for (const [name, expectedRing, expectedBox] of [
    ['farm-stream-water', 0.2874, 0.2066], ['farm-stream-rim', 0.1374, 0.0566],
    ['farm-path-edge', 1.3464, 1.2235], ['farm-path-surface', 1.4164, 1.2935],
  ]) {
    const mesh = scene.getObjectByName(name);
    const ringGap = ribbonDistance(mesh, ring);
    const boxGap = ribbonDistance(mesh, placementFootprint);
    assert.ok(ringGap > 0 && boxGap > 0, `${name} touches the relocated nest`);
    near(ringGap, expectedRing, 0.002);
    near(boxGap, expectedBox, 0.002);
  }
  const bridge = obstacles.find((entry) => entry.name === 'wooden-bridge');
  const bridgeFootprint = boxFootprint(new THREE.Box3(
    new THREE.Vector3(bridge.minX, 0, bridge.minZ), new THREE.Vector3(bridge.maxX, 0, bridge.maxZ),
  ));
  near(footprintDistance(ring, bridgeFootprint), 1.66, 0.001);
  near(footprintDistance(placementFootprint, bridgeFootprint), 1.66, 0.001);
  const waterFootprints = obstacles.filter((entry) => entry.name.startsWith('stream-water-')).map((entry) =>
    boxFootprint(new THREE.Box3(new THREE.Vector3(entry.minX, 0, entry.minZ), new THREE.Vector3(entry.maxX, 0, entry.maxZ))));
  near(Math.min(...waterFootprints.map((footprint) => footprintDistance(ring, footprint))), 0.2027, 0.002);
  near(Math.min(...waterFootprints.map((footprint) => footprintDistance(placementFootprint, footprint))), 0.1223, 0.002);
  const stairFootprints = [...stairs.treads, stairs.footPad].map((step) => boxFootprint(new THREE.Box3().setFromObject(step)));
  near(Math.min(...stairFootprints.map((footprint) => footprintDistance(ring, footprint))), 3.41, 0.001);
  near(Math.min(...stairFootprints.map((footprint) => footprintDistance(placementFootprint, footprint))), 3.41, 0.001);
  near(5.2 - nestBounds.max.x, 0.61, 0.001);
  const nestBlocker = { kind: 'box', name: 'nest', minX: nestBounds.min.x, maxX: nestBounds.max.x,
    minZ: nestBounds.min.z, maxZ: nestBounds.max.z };
  const grid = createGrid(16);
  assert.equal(intersectsFootprint(grid.footprint(grid.cellAt(2.25, 0.75), 'fence', 0), nestBlocker), false);
  assert.equal(intersectsFootprint(grid.footprint(grid.cellAt(5.25, 0.75), 'fence', 0), nestBlocker), true);

  // The locked start meets the rim, but the pond's unchanged inner water
  // ends farther back; record the separation without inventing a new route.
  const ray = new THREE.Raycaster();
  const pondWater = scene.getObjectByName('farm-pond-water');
  let inside = -2.8;
  let outside = -2.45;
  for (let i = 0; i < 30; i++) {
    const z = (inside + outside) / 2;
    ray.set(new THREE.Vector3(3.9, 10, z), new THREE.Vector3(0, -1, 0));
    if (ray.intersectObject(pondWater).length) inside = z;
    else outside = z;
  }
  near(inside, -2.59206, 0.0001);
  near(WATER_FEATURE.stream.points[0][1] - inside, 0.14206, 0.0001);
});

test('water adds no lights or emissive materials in day, sunset, night or rain', () => {
  const { scene, windows, extraEmissives } = fixture();
  const character = createCharacter();
  character.position.y = GROUND_HEIGHT;
  scene.add(character);
  const cycle = createDayNightCycle({ scene, character, windows, extraEmissives });
  const points = [];
  scene.traverse((object) => { if (object.isPointLight) points.push(object.name); });
  assert.deepEqual(points.sort(), ['lantern-light', 'window-light-1', 'window-light-2']);
  for (const phase of ['daytime', 'sunset', 'night']) {
    cycle.setDayNightPhase(phase);
    scene.getObjectByName('farm-water-feature').traverse((object) => {
      if (object.isMesh) assert.equal(object.material.emissive.getHex(), 0, object.name);
    });
  }
});

test('the placement ghost follows the relocated nest bounds instead of a stale old-position blocker', (t) => {
  const dom = new JSDOM('<!doctype html><body><canvas id="scene"></canvas></body>', { url: 'http://localhost/' });
  const previous = { window: globalThis.window, document: globalThis.document, HTMLElement: globalThis.HTMLElement, Node: globalThis.Node };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  const canvas = document.querySelector('#scene');
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
  const scene = new THREE.Scene();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_HEIGHT;
  scene.add(ground);
  const character = new THREE.Group();
  character.position.y = GROUND_HEIGHT;
  scene.add(character);
  const nest = createFarmDecorations(scene, GROUND_HEIGHT).find((object) => object.name === 'farm-nest-decoration');
  const { camera, follow, resize } = createIsometricCamera();
  resize(800, 600);
  follow(character.position);
  const placement = createPlacement({
    scene, camera, canvas, ground, groundSize: 16, groundHeight: GROUND_HEIGHT,
    character, characterRadius: 0.4, obstacles: [], getBlockers: () => [nest],
  });
  t.after(() => {
    placement.dispose();
    dom.window.close();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });

  function hover(x, z) {
    camera.updateMatrixWorld();
    const point = new THREE.Vector3(x, GROUND_HEIGHT, z).project(camera);
    const rect = canvas.getBoundingClientRect();
    const event = new dom.window.MouseEvent('pointermove', {
      bubbles: true, clientX: rect.left + (point.x + 1) * rect.width / 2, clientY: rect.top + (1 - point.y) * rect.height / 2,
    });
    Object.defineProperty(event, 'isPrimary', { value: true });
    canvas.dispatchEvent(event);
    return document.querySelector('.placement-status').textContent;
  }
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'KeyF' }));
  assert.match(hover(2.25, 0.75), /Ready to place/); // The tile touched only by the old nest.
  assert.match(hover(5.25, 0.75), /Blocked by a farm object/); // Partial overlap with the new bounds.
  assert.equal(document.querySelector('[data-confirm]').disabled, true);
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Enter' }));
  assert.equal(scene.getObjectsByProperty('name', 'placed-fence').length, 0);
  nest.position.set(3.2, GROUND_HEIGHT, 1.2); // Test the existing live-bounds wiring in isolation.
  assert.match(hover(2.25, 0.75), /Blocked by a farm object/);
  assert.match(hover(5.25, 0.75), /Ready to place/);
  nest.position.set(4.3, GROUND_HEIGHT, 0.7);
  assert.match(hover(5.25, 0.75), /Blocked by a farm object/);
});
