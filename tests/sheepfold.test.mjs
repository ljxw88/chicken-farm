import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { createSheep, SHEEP_WOOL, SHEEP_NOD_ANGLE } = await vite.ssrLoadModule('/src/scene/sheep/createSheep.ts');
const { createSheepfold, SHEEPFOLD } = await vite.ssrLoadModule('/src/scene/sheepfold/createSheepfold.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsometricCamera } = await vite.ssrLoadModule('/src/scene/createIsometricCamera.ts');
const { createPlacement } = await vite.ssrLoadModule('/src/placement/createPlacement.ts');
const { createGrid, intersectsFootprint } = await vite.ssrLoadModule('/src/placement/grid.ts');
const { moveWithFarmCollisions } = await vite.ssrLoadModule('/src/character/farmCollisions.ts');
after(() => vite.close());

const near = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const descendants = (object, predicate) => {
  const result = [];
  object.traverse((child) => { if (predicate(child)) result.push(child); });
  return result;
};

test('two distinct low-poly sheep have the approved palette, proportions and grounded feet', () => {
  assert.deepEqual(SHEEP_WOOL, { top: 0xfff1d7, base: 0xf3ead6, shade: 0xe4d1ae });
  const layouts = [];
  for (const variant of [0, 1]) {
    const { group } = createSheep(variant, 0);
    group.updateMatrixWorld(true);
    const wool = descendants(group, (mesh) => mesh.name.includes('-wool-'));
    assert.equal(wool.length, 3);
    assert.deepEqual(new Set(wool.map((mesh) => mesh.material.color.getHex())), new Set(Object.values(SHEEP_WOOL)));
    assert.ok(wool.every((mesh) => mesh.geometry.type === 'IcosahedronGeometry' &&
      mesh.geometry.parameters.detail <= 1 && mesh.material.flatShading && mesh.material.emissive.getHex() === 0));
    const woolBounds = new THREE.Box3();
    for (const mesh of wool) woolBounds.union(new THREE.Box3().setFromObject(mesh));
    const woolSize = woolBounds.getSize(new THREE.Vector3());
    assert.ok(woolSize.x >= 0.5 && woolSize.x <= 0.65, `wool width ${woolSize.x}`);
    assert.ok(woolSize.y >= 0.5 && woolSize.y <= 0.65, `wool height ${woolSize.y}`);
    assert.ok(woolSize.z >= 0.85 && woolSize.z <= 1.0, `wool length ${woolSize.z}`);
    layouts.push(wool.map((mesh) => [mesh.position.toArray(), mesh.scale.toArray()]));

    const legs = descendants(group, (mesh) => mesh.name.endsWith('-leg'));
    assert.equal(legs.length, 4);
    for (const leg of legs) {
      assert.deepEqual([leg.geometry.parameters.width, leg.geometry.parameters.height, leg.geometry.parameters.depth], [0.12, 0.2, 0.12]);
      assert.equal(leg.material.color.getHex(), 0x6b4a2e);
      near(new THREE.Box3().setFromObject(leg).min.y, 0);
      const ray = new THREE.Raycaster();
      const intersections = [];
      for (const dx of [-0.04, 0, 0.04]) for (const dz of [-0.04, 0, 0.04]) {
        ray.set(new THREE.Vector3(leg.position.x + dx, -0.1, leg.position.z + dz), new THREE.Vector3(0, 1, 0));
        const hit = ray.intersectObjects(wool)[0];
        if (hit) intersections.push(hit.point.y);
      }
      assert.ok(Math.min(...intersections) <= 0.2 + 1e-6, `leg is detached from wool: ${intersections}`);
    }
    const face = group.getObjectByName(`sheep-${variant + 1}-face`);
    assert.deepEqual([face.geometry.parameters.width, face.geometry.parameters.height, face.geometry.parameters.depth], [0.3, 0.3, 0.32]);
    assert.equal(face.material.color.getHex(), 0x6b4a2e);
    assert.ok(face.getWorldPosition(new THREE.Vector3()).z > 0.4, '+Z is the face/front');
    const ears = descendants(group, (mesh) => mesh.name.endsWith('-ear'));
    assert.equal(ears.length, 2);
    assert.ok(ears.every((ear) => ear.geometry.parameters.width >= 0.1 && ear.geometry.parameters.height >= 0.1 &&
      ear.geometry.parameters.depth >= 0.1 && ear.material.color.getHex() === 0x7a5a3a));
    assert.equal(group.getObjectByName(`sheep-${variant + 1}-nose`).material.color.getHex(), 0x7a5a3a);
    for (const mesh of descendants(group, (child) => child.geometry?.type === 'BoxGeometry')) {
      const { width, height, depth } = mesh.geometry.parameters;
      assert.ok(Math.min(width, height, depth) >= 0.1, `${mesh.name} has a sub-0.1 detail`);
    }
    const box = new THREE.Box3().setFromObject(group);
    assert.ok(box.min.y >= -0.01 && box.max.y >= 0.75 && box.max.y <= 0.82, `sheep height ${box.min.y}..${box.max.y}`);
    if (variant === 1) {
      assert.equal(face.material.vertexColors, true);
      assert.ok(face.geometry.getAttribute('color').getX(0) < 1, 'second head must actually be darker');
    }
  }
  assert.notDeepEqual(layouts[0], layouts[1]);
});

test('seeded sheep graze independently at ±12 degrees on a four-second loop without moving their bodies', () => {
  function pose(seed) {
    const scene = new THREE.Scene();
    const fold = createSheepfold(scene, seed);
    const heads = [1, 2].map((index) => scene.getObjectByName(`sheep-${index}-head-pivot`));
    const positions = [1, 2].map((index) => scene.getObjectByName(`sheep-${index}`).position.toArray());
    return { scene, fold, heads, positions };
  }
  const a = pose(123);
  const b = pose(123);
  const c = pose(124);
  const angles = (fixture) => fixture.heads.map((head) => head.rotation.x);
  assert.deepEqual(angles(a), angles(b));
  assert.notDeepEqual(angles(a), angles(c));
  assert.notEqual(angles(a)[0], angles(a)[1]);
  const initial = angles(a);
  const samples = [];
  for (let i = 0; i < 40; i++) {
    a.fold.update(0.1);
    samples.push(angles(a)[0]);
    assert.ok(angles(a).every((angle) => Math.abs(angle) <= SHEEP_NOD_ANGLE + 1e-9));
    a.scene.updateMatrixWorld(true);
    for (const index of [1, 2]) {
      const animal = a.scene.getObjectByName(`sheep-${index}`);
      near(animal.position.y, 0);
      assert.ok(new THREE.Box3().setFromObject(animal).min.y >= 2.39);
    }
  }
  assert.ok(Math.min(...samples) < -SHEEP_NOD_ANGLE * 0.99 && Math.max(...samples) > SHEEP_NOD_ANGLE * 0.99);
  angles(a).forEach((angle, index) => near(angle, initial[index]));
  assert.deepEqual([1, 2].map((index) => a.scene.getObjectByName(`sheep-${index}`).position.toArray()), a.positions);
});

function distanceFromBox(box, obstacle) {
  if (obstacle.kind === 'circle') {
    const dx = Math.max(box.minX - obstacle.x, 0, obstacle.x - box.maxX);
    const dz = Math.max(box.minZ - obstacle.z, 0, obstacle.z - box.maxZ);
    return Math.hypot(dx, dz) - obstacle.radius;
  }
  return Math.hypot(Math.max(box.minX - obstacle.maxX, 0, obstacle.minX - box.maxX),
    Math.max(box.minZ - obstacle.maxZ, 0, obstacle.minZ - box.maxZ));
}

test('signed fence segments, shelter and sheep fit with the required surrounding clearances', () => {
  const scene = new THREE.Scene();
  const farm = createFarmLayout(scene);
  const fold = createSheepfold(scene, 123);
  scene.updateMatrixWorld(true);
  near(SHEEPFOLD.width, 4.5);
  near(SHEEPFOLD.depth, 3);
  near(Math.hypot(SHEEPFOLD.x + 5.2, SHEEPFOLD.z - 4.6), 0.5);
  const fences = fold.obstacles.filter((obstacle) => obstacle.name.startsWith('sheepfold-fence-'));
  assert.equal(fences.length, 9);
  for (const fence of fences) {
    const dx = fence.maxX - fence.minX;
    const dz = fence.maxZ - fence.minZ;
    near(Math.max(dx, dz), 1.47);
    near(Math.min(dx, dz), 0.26);
    const visual = scene.getObjectByName(fence.name);
    assert.ok(visual.children.every((child) => [0x8b6914, 0xd4a574].includes(child.material.color.getHex())));
  }
  const extents = {
    minX: Math.min(...fences.map((fence) => fence.minX)), maxX: Math.max(...fences.map((fence) => fence.maxX)),
    minZ: Math.min(...fences.map((fence) => fence.minZ)), maxZ: Math.max(...fences.map((fence) => fence.maxZ)),
  };
  assert.ok(8 - Math.max(...Object.values(extents).map(Math.abs)) >= 1 - 1e-9, `rim clearance: ${JSON.stringify(extents)}`);
  for (const obstacle of farm.obstacles) {
    assert.ok(distanceFromBox(extents, obstacle) >= 0.8 - 1e-9, `${obstacle.name} is too close`);
  }
  const path = new THREE.Box3().setFromObject(scene.getObjectByName('farm-path-edge'));
  assert.ok(extents.minZ - path.max.z >= 0.8, `the pen is too close to the path: ${extents.minZ - path.max.z}`);
  const shelter = fold.obstacles.find((obstacle) => obstacle.name === 'sheepfold-lean-to');
  near(shelter.maxX - shelter.minX, 1.4);
  near(shelter.maxZ - shelter.minZ, 1.2);
  const roof = scene.getObjectByName('sheepfold-roof');
  const roofBounds = new THREE.Box3().setFromObject(roof);
  near(roofBounds.max.y - 2.4, 1.1);
  near(roofBounds.max.x - roofBounds.min.x, 1.64);
  near(roofBounds.max.z - roofBounds.min.z, 1.44);
  assert.equal(roof.material.color.getHex(), 0xa94a30);
  const shelterParts = descendants(scene.getObjectByName('sheepfold-lean-to'), (object) => object.isMesh);
  assert.equal(shelterParts.filter((mesh) => mesh.name === 'sheepfold-back-wall').length, 1);
  assert.equal(shelterParts.filter((mesh) => mesh.name === 'sheepfold-side-wall').length, 2);
  assert.equal(shelterParts.filter((mesh) => mesh.name === 'sheepfold-post').length, 4);
  assert.ok(shelterParts.every((mesh) => !/door|window|front-wall/.test(mesh.name)));
  assert.ok(shelterParts
    .every((mesh) => [0xc8956c, 0xa94a30, 0x6b4423].includes(mesh.material.color.getHex()) && mesh.material.emissive.getHex() === 0));
  for (const index of [1, 2]) {
    const sheep = fold.obstacles.find((obstacle) => obstacle.name === `sheep-${index}`);
    assert.equal(sheep.kind, 'circle');
    assert.equal(sheep.radius, 0.4);
  }
});

test('the center opening is walkable; the front fence, shelter and sheep stop the player', () => {
  const fold = createSheepfold(new THREE.Scene(), 123);
  const { x, z, sheepOffsetX, sheepZ } = SHEEPFOLD;
  const entered = moveWithFarmCollisions(x, 7, 0, -2.5, 0.4, fold.obstacles);
  assert.ok(entered.z < z + 0.6, `opening blocked: ${entered.z}`);
  assert.ok(entered.z >= 4.94 - 1e-8 && entered.z < 5.1, `shelter not solid: ${entered.z}`);
  const outside = moveWithFarmCollisions(entered.x, entered.z, 0, 2.3, 0.4, fold.obstacles);
  assert.ok(outside.z > 6.8, `player could not exit: ${outside.z}`);
  const fence = moveWithFarmCollisions(x + 1.5, 7, 0, -2.5, 0.4, fold.obstacles);
  assert.ok(fence.z >= 6.53 - 1e-8 && fence.z < 6.7, `front fence not solid: ${fence.z}`);
  const side = moveWithFarmCollisions(-7.5, z, 1, 0, 0.4, fold.obstacles);
  assert.ok(side.x <= -7.4 + 1e-8 && side.x >= -7.5 - 1e-8, `side fence not solid: ${side.x}`);
  const sheep = moveWithFarmCollisions(x - sheepOffsetX, 5.4, 0, -1.0, 0.4, fold.obstacles);
  assert.ok(sheep.z >= sheepZ + 0.8 - 1e-8 && sheep.z < sheepZ + 0.9, `sheep not solid: ${sheep.z}`);
});

test('walkable fold positions sampled at 0.05 units connect back to the outside', () => {
  const scene = new THREE.Scene();
  const farm = createFarmLayout(scene);
  const fold = createSheepfold(scene, 123);
  const obstacles = [...farm.obstacles, ...fold.obstacles];
  const step = 0.05;
  const originX = -7.6;
  const originZ = 2.3;
  const columns = 125;
  const rows = 107;
  const position = (column, row) => [originX + column * step, originZ + row * step];
  const blocked = (x, z) => obstacles.some((obstacle) => {
    if (obstacle.blocksWalking === false) return false;
    if (obstacle.kind === 'circle') return Math.hypot(x - obstacle.x, z - obstacle.z) <= obstacle.radius + 0.4;
    return Math.hypot(Math.max(obstacle.minX - x, 0, x - obstacle.maxX),
      Math.max(obstacle.minZ - z, 0, z - obstacle.maxZ)) <= 0.4;
  });
  const startColumn = Math.round((-4.7 - originX) / step);
  const startRow = Math.round((7 - originZ) / step);
  const encode = (column, row) => row * columns + column;
  const queue = [[startColumn, startRow]];
  const seen = new Set([encode(startColumn, startRow)]);
  for (let index = 0; index < queue.length; index++) {
    const [column, row] = queue[index];
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextColumn = column + dx;
      const nextRow = row + dz;
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const key = encode(nextColumn, nextRow);
      const [x, z] = position(nextColumn, nextRow);
      if (seen.has(key) || blocked(x, z)) continue;
      seen.add(key);
      queue.push([nextColumn, nextRow]);
    }
  }
  let checked = 0;
  const unreachable = [];
  for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
    const [x, z] = position(column, row);
    if (x <= SHEEPFOLD.x - SHEEPFOLD.width / 2 || x >= SHEEPFOLD.x + SHEEPFOLD.width / 2 ||
        z <= SHEEPFOLD.z - SHEEPFOLD.depth / 2 || z >= SHEEPFOLD.z + SHEEPFOLD.depth / 2 || blocked(x, z)) continue;
    checked++;
    if (!seen.has(encode(column, row))) unreachable.push([x, z]);
  }
  assert.ok(checked > 100, `not enough walkable interior samples: ${checked}`);
  assert.deepEqual(unreachable, [], `sheep or shelter isolated reachable player positions: ${JSON.stringify(unreachable.slice(0, 8))}`);
});

test('every overlapping fence or plot tile is reserved, including the opening and empty pen interior', (t) => {
  const dom = new JSDOM('<!doctype html><body><canvas id="scene"></canvas></body>', { url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  const scene = new THREE.Scene();
  const { obstacles } = createSheepfold(scene, 123);
  // Isolate the placement-only reservation so physical fences cannot hide a
  // missing interior/opening blocker.
  const reserve = obstacles.find((obstacle) => obstacle.name === 'sheepfold-placement');
  assert.equal(reserve.blocksWalking, false);
  const canvas = document.querySelector('#scene');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 2.4;
  scene.add(ground);
  const character = new THREE.Group();
  character.position.y = 2.4;
  scene.add(character);
  const { camera, resize, follow } = createIsometricCamera();
  resize(1280, 720);
  follow(character.position);
  const placement = createPlacement({ scene, camera, canvas, ground, groundSize: 16, groundHeight: 2.4,
    character, characterRadius: 0.4, obstacles: [reserve] });
  t.after(() => { placement.dispose(); dom.window.close(); });
  const key = (code) => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { bubbles: true, code }));
  const pointer = (x, z) => {
    camera.updateMatrixWorld();
    const projected = new THREE.Vector3(x, 2.4, z).project(camera);
    const event = new dom.window.MouseEvent('pointermove', { bubbles: true,
      clientX: (projected.x + 1) * 640, clientY: (1 - projected.y) * 360 });
    Object.defineProperty(event, 'isPrimary', { value: true });
    canvas.dispatchEvent(event);
  };
  const grid = createGrid(16);
  for (const kind of ['fence', 'plot']) for (let rotation = 0; rotation < 4; rotation++) {
    key(kind === 'fence' ? 'KeyF' : 'KeyP');
    for (let turn = 0; turn < rotation; turn++) key('KeyR');
    for (let column = 0; column < grid.count; column++) for (let row = 0; row < grid.count; row++) {
      const area = grid.footprint({ column, row }, kind, rotation);
      if (!grid.contains(area) || !intersectsFootprint(area, reserve)) continue;
      pointer(grid.min + (column + 0.5) * 1.5, grid.min + (row + 0.5) * 1.5);
      assert.match(document.querySelector('.placement-status').textContent, /Blocked by a farm object/,
        `${kind} rotation ${rotation} tile ${column},${row}`);
      assert.equal(document.querySelector('[data-confirm]').disabled, true);
    }
  }
});

test('new contact shadows track the existing sun direction and weather opacity', () => {
  const scene = new THREE.Scene();
  const fold = createSheepfold(scene, 123);
  const { camera, resize, follow } = createIsometricCamera();
  resize(1280, 720);
  follow(new THREE.Vector3(0, 2.4, 0));
  camera.updateMatrixWorld();
  for (const [offset, strength] of [[0.48, 1], [0.266, 1], [0.16, 0.09 / 0.22], [0.133, 0.5]]) {
    fold.updateShadows(0.8, -0.6, offset, strength);
    scene.updateMatrixWorld(true);
    for (const name of ['sheep-1', 'sheep-2', 'sheepfold-lean-to', ...Array.from({ length: 9 }, (_, i) => `sheepfold-fence-${i + 1}`)]) {
      const object = scene.getObjectByName(name);
      const shadow = scene.getObjectByName(`${name}-shadow`);
      const shadowPosition = shadow.getWorldPosition(new THREE.Vector3());
      const origin = object.getWorldPosition(new THREE.Vector3());
      const delta = shadowPosition.clone().sub(origin).setY(0);
      assert.ok(delta.dot(new THREE.Vector3(0.8, 0, -0.6)) > 0);
      assert.ok(delta.clone().normalize().dot(new THREE.Vector3(0.8, 0, -0.6)) > 0.999999);
      // Compare at the shadow's ground-plane lift, so the lift itself does
      // not masquerade as an upward shadow displacement on screen.
      const from = origin.setY(shadowPosition.y).project(camera);
      const to = shadowPosition.project(camera);
      assert.ok(to.x > from.x && to.y <= from.y + 1e-9, `${name} shadow is not screen lower-right`);
      assert.equal(shadow.material.color.getHex(), 0x0a1409);
      near(shadow.material.opacity, (name.startsWith('sheep-') ? 0.18 : 0.12) * strength);
    }
  }
});
