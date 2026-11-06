import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { FARM_BUILDINGS } = await vite.ssrLoadModule('/src/scene/createFarmBuildings.ts');
const { createFarmLayout, FARM_LAYOUT } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsland, GROUND_HEIGHT } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { moveWithFarmCollisions } = await vite.ssrLoadModule('/src/scene/farmCollisions.ts');
after(() => vite.close());

const components = [
  { name: 'cottage', mesh: 'cottage-walls', bounds: [-5.6, -1.2, -4.9, -1.9] },
  { name: 'ramp-coop-1-body', mesh: 'ramp-coop-1-body', bounds: [-0.55, 0.85, -3.85, -2.55] },
  { name: 'ramp-coop-1-ramp', mesh: 'ramp-coop-1-ramp', bounds: [-0.15, 0.45, -2.55, -1.45] },
  { name: 'ramp-coop-2-body', mesh: 'ramp-coop-2-body', bounds: [0.65, 2.05, -5.65, -4.35] },
  { name: 'ramp-coop-2-ramp', mesh: 'ramp-coop-2-ramp', bounds: [1.05, 1.65, -4.35, -3.25] },
];

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function bounds(scene, name) {
  const object = scene.getObjectByName(name);
  assert.ok(object, name);
  return new THREE.Box3().setFromObject(object);
}

function assertXZ(box, [minX, maxX, minZ, maxZ]) {
  near(box.min.x, minX);
  near(box.max.x, maxX);
  near(box.min.z, minZ);
  near(box.max.z, maxZ);
}

function assertObstacle(box, obstacle) {
  assert.equal(obstacle.kind, 'box');
  assertXZ(box, [obstacle.minX, obstacle.maxX, obstacle.minZ, obstacle.maxZ]);
}

function rectanglesOverlap(a, b) {
  return a.min.x < b.max.x - 1e-7 && a.max.x > b.min.x + 1e-7 &&
    a.min.z < b.max.z - 1e-7 && a.max.z > b.min.z + 1e-7;
}

// Separating axes catch a path triangle crossing a box even if no triangle
// vertex is inside it. Touching at an edge alone is not an area overlap.
function triangleOverlapsBox(triangle, box) {
  const corners = [[box.min.x, box.min.z], [box.max.x, box.min.z],
    [box.max.x, box.max.z], [box.min.x, box.max.z]];
  const points = triangle.map((point) => [point.x, point.z]);
  const axes = [[1, 0], [0, 1]];
  for (let i = 0; i < 3; i++) {
    const a = points[i];
    const b = points[(i + 1) % 3];
    axes.push([b[1] - a[1], a[0] - b[0]]);
  }
  return axes.every(([x, z]) => {
    const projected = points.map((point) => point[0] * x + point[1] * z);
    const rectangle = corners.map((point) => point[0] * x + point[1] * z);
    return Math.max(...projected) > Math.min(...rectangle) + 1e-8 &&
      Math.max(...rectangle) > Math.min(...projected) + 1e-8;
  });
}

function pathTriangles(surface) {
  const positions = surface.geometry.getAttribute('position');
  const indices = surface.geometry.getIndex();
  assert.ok(indices);
  const triangles = [];
  for (let i = 0; i < indices.count; i += 3) {
    triangles.push([0, 1, 2].map((offset) =>
      surface.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + offset)))));
  }
  return triangles;
}

function pointSegmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
}

function distanceToPath(box, triangles) {
  const corners = [
    new THREE.Vector3(box.min.x, 0, box.min.z), new THREE.Vector3(box.max.x, 0, box.min.z),
    new THREE.Vector3(box.max.x, 0, box.max.z), new THREE.Vector3(box.min.x, 0, box.max.z),
  ];
  let distance = Infinity;
  for (const triangle of triangles) {
    if (triangleOverlapsBox(triangle, box)) return 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const a = triangle[i];
      const b = triangle[(i + 1) % 3];
      const c = corners[j];
      const d = corners[(j + 1) % 4];
      distance = Math.min(distance, pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
    }
  }
  return distance;
}

test('the locked cottage has the specified walls, stone, roof, chimney, doors and windows', () => {
  const scene = new THREE.Scene();
  const { windows, extraEmissives } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  assert.equal(scene.getObjectByName('farm-barn'), undefined);
  const walls = scene.getObjectByName('cottage-walls');
  const base = scene.getObjectByName('cottage-stone-base');
  const wallBox = bounds(scene, 'cottage-walls').union(bounds(scene, 'cottage-stone-base'));
  assertXZ(wallBox, [-5.6, -1.2, -4.9, -1.9]);
  near(wallBox.min.y, GROUND_HEIGHT);
  near(wallBox.max.y, GROUND_HEIGHT + 2);
  near(base.geometry.parameters.height, 0.25);
  assert.equal(walls.material.color.getHex(), 0xefe3c8);
  assert.equal(base.material.color.getHex(), 0x9a8a78);
  assert.ok(scene.getObjectsByProperty('name', 'cottage-corner-post')
    .every((post) => post.material.color.getHex() === 0x8b5e3c && post.geometry.parameters.width >= 0.12));
  assert.equal(scene.getObjectByName('cottage-door-frame').material.color.getHex(), 0x8b5e3c);
  const door = scene.getObjectByName('cottage-door');
  assert.equal(door.material.color.getHex(), 0x6b4423);
  near(door.geometry.parameters.width, 1.1);
  near(door.geometry.parameters.height, 1.6);

  const roof = bounds(scene, 'cottage-roof');
  assertXZ(roof, [-5.85, -0.95, -5.15, -1.65]);
  near(roof.max.y, GROUND_HEIGHT + 3.1);
  const slopes = scene.getObjectsByProperty('name', 'cottage-roof-slope');
  const bands = scene.getObjectsByProperty('name', 'cottage-shingle-band');
  assert.equal(slopes.length, 2);
  assert.equal(bands.length, 8);
  assert.ok(slopes.every((mesh) => mesh.material.color.getHex() === 0xc45a3a));
  assert.ok(bands.every((mesh) => mesh.material.color.getHex() === 0xa94a30));
  for (const side of [-1, 1]) {
    const measured = bands.map((mesh) => new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).z + 3.4)
      .filter((z) => Math.sign(z) === side).map(Math.abs).sort((a, b) => a - b);
    assert.equal(measured.length, 4);
    for (let i = 1; i < measured.length; i++) near((measured[i] - measured[i - 1]) * Math.hypot(1, 1.1 / 1.5), 0.45);
  }
  for (const mesh of bands) {
    const band = new THREE.Box3().setFromObject(mesh);
    assert.ok(band.max.z - band.min.z >= 0.1 - 1e-6);
  }
  // Roof and gable must not be coplanar, which rendered pale z-fighting stripes.
  const ray = new THREE.Raycaster();
  for (const dz of [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3]) {
    ray.set(new THREE.Vector3(-3.4, 10, -3.4 + dz), new THREE.Vector3(0, -1, 0));
    const top = ray.intersectObject(scene.getObjectByName('farm-cottage'), true)[0];
    assert.ok(['cottage-roof-slope', 'cottage-shingle-band'].includes(top.object.name), top.object.name);
  }

  const chimney = bounds(scene, 'cottage-chimney');
  assertXZ(chimney, [-2.125, -1.675, -4.325, -3.875]);
  assert.equal(scene.getObjectByName('cottage-chimney').material.color.getHex(), 0x9a8a78);
  const anchor = scene.getObjectByName('cottage-chimney-top').getWorldPosition(new THREE.Vector3());
  near(anchor.x, -1.9);
  near(anchor.z, -4.1);
  near(anchor.y, GROUND_HEIGHT + 3.6);
  near(chimney.max.y, anchor.y);
  assert.ok(anchor.y > roof.max.y);

  assert.deepEqual(windows.map((window) => window.name), ['cottage-window-1', 'cottage-window-2']);
  for (const [index, pane] of windows.entries()) {
    const p = pane.getWorldPosition(new THREE.Vector3());
    near(p.x, [-4.6, -2.2][index]);
    near(p.y, GROUND_HEIGHT + 1.2);
    near(p.z, -1.9);
    near(pane.geometry.parameters.width, 0.8);
    near(pane.geometry.parameters.height, 0.8);
    near(pane.geometry.parameters.depth, 0.1);
    assert.equal(pane.material.color.getHex(), 0x8aa0a8);
  }
  const east = scene.getObjectByName('cottage-east-window');
  assert.equal(east.material.color.getHex(), 0x8aa0a8);
  assert.equal(extraEmissives[0].material, east.material);
  const eastPosition = east.getWorldPosition(new THREE.Vector3());
  near(eastPosition.x, -1.2);
  near(eastPosition.y, GROUND_HEIGHT + 1.2);
  near(eastPosition.z, -3.4);
  near(east.geometry.parameters.width, 0.8);
  near(east.geometry.parameters.height, 0.8);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(east.getWorldQuaternion(new THREE.Quaternion()));
  near(normal.x, 1);
  near(normal.z, 0);
});

test('both locked coops have raised bodies, posts, roof, pop-holes and cleated ramps', () => {
  const scene = new THREE.Scene();
  const { extraEmissives } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const cases = [
    { name: 'ramp-coop-1', body: [-0.55, 0.85, -3.85, -2.55], ramp: [-0.15, 0.45, -2.55, -1.45], roof: [-0.7, 1, -4, -2.4] },
    { name: 'ramp-coop-2', body: [0.65, 2.05, -5.65, -4.35], ramp: [1.05, 1.65, -4.35, -3.25], roof: [0.5, 2.2, -5.8, -4.2] },
  ];
  for (const [index, { name, body, ramp, roof }] of cases.entries()) {
    const group = scene.getObjectByName(`farm-${name}`);
    const wall = scene.getObjectByName(`${name}-body`);
    const wallBox = bounds(scene, `${name}-body`);
    assertXZ(wallBox, body);
    near(wallBox.min.y, GROUND_HEIGHT + 0.35);
    near(wallBox.max.y, GROUND_HEIGHT + 1.45);
    assert.equal(wall.material.color.getHex(), 0xc8956c);
    const posts = group.getObjectsByProperty('name', `${name}-post`);
    assert.equal(posts.length, 4);
    assert.ok(posts.every((post) => post.material.color.getHex() === 0x6b4423 &&
      post.geometry.parameters.width >= 0.3 && post.geometry.parameters.depth >= 0.3));
    const trims = group.getObjectsByProperty('name', `${name}-corner-trim`);
    assert.ok(trims.length > 0 && trims.every((trim) => trim.material.color.getHex() === 0x8b5e3c));
    const roofBox = bounds(scene, `${name}-roof`);
    assertXZ(roofBox, roof);
    near(roofBox.max.y, GROUND_HEIGHT + 1.95);
    assert.ok(group.getObjectsByProperty('name', `${name}-roof-slope`)
      .every((slope) => slope.material.color.getHex() === 0xa94a30));
    const rampBox = bounds(scene, `${name}-ramp`);
    assertXZ(rampBox, ramp);
    near(rampBox.min.y, GROUND_HEIGHT);
    near(rampBox.max.y, GROUND_HEIGHT + 0.35);
    assert.equal(scene.getObjectByName(`${name}-ramp`).material.color.getHex(), 0xa67c52);
    const cleats = group.getObjectsByProperty('name', `${name}-ramp-cleat`);
    assert.equal(cleats.length, 4);
    assert.ok(cleats.every((cleat) => cleat.material.color.getHex() === 0x7a5a3a &&
      cleat.geometry.parameters.height >= 0.1 && cleat.geometry.parameters.depth >= 0.1));
    for (let i = 1; i < cleats.length; i++) near(cleats[i].position.z - cleats[i - 1].position.z, 0.25);
    const hole = scene.getObjectByName(`${name}-pop-hole`);
    assert.equal(hole.material.color.getHex(), 0x3e2a1a);
    near(hole.geometry.parameters.width, 0.4);
    near(hole.geometry.parameters.height, 0.5);
    const glow = scene.getObjectByName(`${name}-pop-hole-glow`);
    near(glow.geometry.parameters.width, 0.2);
    near(glow.geometry.parameters.height, 0.25);
    assert.equal(extraEmissives[index + 1].material, glow.material);
    near(extraEmissives[index + 1].strength, 0.7);
  }
});

test('walking obstacles match only the visible wall, coop bodies and ramps, while roofs shelter rain', () => {
  const scene = new THREE.Scene();
  const { obstacles, splashExclusions } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const originalNames = [...components.map(({ name }) => name), 'tree-1', 'tree-2', 'tree-3', 'tree-4', 'pond'];
  assert.deepEqual(obstacles.filter((entry) => originalNames.includes(entry.name)).map((entry) => entry.name), originalNames);
  for (const { name, mesh, bounds: expected } of components) {
    const box = bounds(scene, mesh);
    const obstacle = obstacles.find((entry) => entry.name === name);
    assert.ok(obstacle, name);
    assertXZ(box, expected);
    assertObstacle(box, obstacle);
    const x = (box.min.x + box.max.x) / 2;
    const z = (box.min.z + box.max.z) / 2;
    for (const approach of [
      { x, z: box.max.z + 2, dx: 0, dz: -10, axis: 'z', face: box.max.z + 0.4, sign: 1 },
      { x, z: box.min.z - 2, dx: 0, dz: 10, axis: 'z', face: box.min.z - 0.4, sign: -1 },
      { x: box.max.x + 2, z, dx: -10, dz: 0, axis: 'x', face: box.max.x + 0.4, sign: 1 },
      { x: box.min.x - 2, z, dx: 10, dz: 0, axis: 'x', face: box.min.x - 0.4, sign: -1 },
    ]) {
      const result = moveWithFarmCollisions(approach.x, approach.z, approach.dx, approach.dz, 0.4, [obstacle]);
      const gap = (result[approach.axis] - approach.face) * approach.sign;
      assert.ok(gap >= -1e-7 && gap <= 0.101, `${name} stopped ${gap} from its visible face`);
    }
  }
  for (const name of ['cottage', 'ramp-coop-1', 'ramp-coop-2']) {
    const roof = bounds(scene, `${name}-roof`);
    const shelter = splashExclusions.find((entry) => entry.name === `${name}-roof`);
    assertObstacle(roof, shelter);
    assert.ok(!obstacles.some((entry) => entry.name === `${name}-roof`));
  }
  // A small probe fits under the cottage eave without a phantom roof collider.
  const cottage = obstacles.find((entry) => entry.name === 'cottage');
  const clear = moveWithFarmCollisions(-1.05, -5.5, 0, 4.5, 0.05, [cottage]);
  near(clear.z, -1);
});

test('locked gaps, walkable path surface, stairs and the +X keep-out remain verifiable', () => {
  assert.deepEqual(FARM_LAYOUT.trees, [
    { x: -2.15, z: 1.55, scale: 0.95 }, { x: 4.8, z: 1.6, scale: 1 },
    { x: -5.8, z: -0.1, scale: 1.05 }, { x: 0.05, z: -5.6, scale: 0.95 },
  ]);
  assert.equal(FARM_LAYOUT.pond.x, 4);
  assert.equal(FARM_LAYOUT.pond.z, -3.5);
  const scene = new THREE.Scene();
  const { stairs } = createIsland(scene);
  const { obstacles } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const cottageRoof = bounds(scene, 'cottage-roof');
  const coopARoof = bounds(scene, 'ramp-coop-1-roof');
  near(coopARoof.min.x - cottageRoof.max.x, 0.25);
  assert.ok(coopARoof.min.x - cottageRoof.max.x >= 0.2);
  const coopB = obstacles.find((entry) => entry.name === 'ramp-coop-2-body');
  const pond = obstacles.find((entry) => entry.name === 'pond');
  near(coopB.maxX, 2.05);
  near(pond.minX, 2.3725);
  near(pond.minX - coopB.maxX, 0.3225);

  const boxes = components.map(({ mesh }) => bounds(scene, mesh));
  const surface = pathTriangles(scene.getObjectByName('farm-path-surface'));
  for (const triangle of surface) for (const [index, box] of boxes.entries()) {
    assert.equal(triangleOverlapsBox(triangle, box), false, `${components[index].name} overlaps the dirt surface`);
  }
  for (const step of [...stairs.treads, stairs.footPad]) {
    const stone = new THREE.Box3().setFromObject(step);
    for (const box of boxes) assert.equal(rectanglesOverlap(stone, box), false, step.name);
  }
  for (const name of ['cottage', 'ramp-coop-1', 'ramp-coop-2']) {
    const group = scene.getObjectByName(`farm-${name}`);
    group.traverse((object) => {
      if (object.isMesh) assert.ok(new THREE.Box3().setFromObject(object).max.x <= 4.5, object.name);
    });
  }
  for (const { name } of components) assert.ok(obstacles.find((entry) => entry.name === name).maxX <= 4.5);

  const border = scene.getObjectByName('farm-path-edge');
  const borderTriangles = pathTriangles(border);
  // Look Dev/PM explicitly chose the locked coordinates over the incompatible
  // 1.5-unit buffer. Record real distances, rather than claiming that buffer.
  near(distanceToPath(boxes[1], borderTriangles), 0.9893, 0.001);
  near(distanceToPath(coopARoof, borderTriangles), 0.7772, 0.001);
  near(distanceToPath(boxes[2], borderTriangles), 0.3497, 0.001);
  near(distanceToPath(boxes[3], borderTriangles), 1.9477, 0.001);
  near(distanceToPath(bounds(scene, 'ramp-coop-2-roof'), borderTriangles), 1.7644, 0.001);
  near(distanceToPath(boxes[4], borderTriangles), 1.0654, 0.001);
  const positions = border.geometry.getAttribute('position');
  const intrusions = [];
  for (let i = 0; i < positions.count; i++) {
    const point = border.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i));
    if (point.x >= -5.6 && point.x <= -1.2 && point.z >= -4.9 && point.z <= -1.9) intrusions.push(point);
  }
  assert.ok(intrusions.some((point) => Math.hypot(point.x + 3.4, point.z + 1.3) > 0.67));
  near(-1.9 - Math.min(...intrusions.map((point) => point.z)), 0.06737, 0.001);
});

test('moving each table entry moves its rendered body, colliders, roof shelter and anchors together', () => {
  for (const [index, building] of FARM_BUILDINGS.entries()) {
    const original = { ...building };
    try {
      Object.assign(building, { x: original.x + 1, z: original.z - 0.5 });
      const scene = new THREE.Scene();
      const { windows, obstacles, splashExclusions } = createFarmLayout(scene);
      scene.updateMatrixWorld(true);
      const bodyName = index === 0 ? 'cottage-walls' : `${building.name}-body`;
      const body = bounds(scene, bodyName);
      near((body.min.x + body.max.x) / 2, building.x);
      near((body.min.z + body.max.z) / 2, building.z);
      assertObstacle(body, obstacles.find((entry) => entry.name === (index === 0 ? building.name : `${building.name}-body`)));
      assertObstacle(bounds(scene, `${building.name}-roof`), splashExclusions.find((entry) => entry.name === `${building.name}-roof`));
      if (index === 0) {
        near(windows[0].getWorldPosition(new THREE.Vector3()).x, building.x - 1.2);
        near(scene.getObjectByName('cottage-chimney-top').getWorldPosition(new THREE.Vector3()).z, building.z - 0.7);
      } else {
        assertObstacle(bounds(scene, `${building.name}-ramp`), obstacles.find((entry) => entry.name === `${building.name}-ramp`));
      }
    } finally {
      Object.assign(building, original);
    }
  }
});
