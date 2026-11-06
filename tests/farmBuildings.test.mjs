import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import * as THREE from 'three';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false }, appType: 'custom' });
const { FARM_BUILDINGS } = await vite.ssrLoadModule('/src/scene/createFarmBuildings.ts');
const { createFarmLayout } = await vite.ssrLoadModule('/src/scene/createFarmLayout.ts');
const { createIsland, GROUND_HEIGHT, GROUND_SIZE } = await vite.ssrLoadModule('/src/scene/createIsland.ts');
const { moveWithFarmCollisions } = await vite.ssrLoadModule('/src/scene/farmCollisions.ts');
const { createPracticalLights } = await vite.ssrLoadModule('/src/lighting/createPracticalLights.ts');
after(() => vite.close());

const names = ['cottage', 'ramp-coop-1', 'ramp-coop-2'];

function near(actual, expected, tolerance = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function bounds(scene, name) {
  const mesh = scene.getObjectByName(`${name}-placeholder`);
  assert.ok(mesh?.isMesh && mesh.geometry.type === 'BoxGeometry', name);
  return new THREE.Box3().setFromObject(mesh);
}

function assertFootprint(box, obstacle) {
  assert.equal(obstacle.kind, 'box');
  near(obstacle.minX, box.min.x);
  near(obstacle.maxX, box.max.x);
  near(obstacle.minZ, box.min.z);
  near(obstacle.maxZ, box.max.z);
  near(box.min.y, GROUND_HEIGHT);
}

function rectanglesOverlap(a, b) {
  return a.min.x < b.max.x - 1e-7 && a.max.x > b.min.x + 1e-7 &&
    a.min.z < b.max.z - 1e-7 && a.max.z > b.min.z + 1e-7;
}

// Separating axes catch a path triangle crossing a box even if no triangle
// vertex is inside it. Touching at an edge alone is not an area overlap.
function triangleOverlapsBox(triangle, box) {
  const corners = [
    [box.min.x, box.min.z], [box.max.x, box.min.z],
    [box.max.x, box.max.z], [box.min.x, box.max.z],
  ];
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

test('one cottage and two coop boxes have distinct visible, solid footprints', () => {
  const scene = new THREE.Scene();
  const { windows, obstacles, splashExclusions } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  assert.equal(scene.getObjectByName('farm-barn'), undefined);
  assert.equal(windows.length, 2);
  const boxes = names.map((name) => {
    assert.ok(scene.getObjectByName(`farm-${name}`), name);
    const box = bounds(scene, name);
    const obstacle = obstacles.find((entry) => entry.name === name);
    assertFootprint(box, obstacle);
    assert.deepEqual(splashExclusions.find((entry) => entry.name === name), obstacle);
    assert.ok(box.min.x >= -GROUND_SIZE / 2 && box.max.x <= GROUND_SIZE / 2);
    assert.ok(box.min.z >= -GROUND_SIZE / 2 && box.max.z <= GROUND_SIZE / 2);
    return box;
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.equal(rectanglesOverlap(boxes[i], boxes[j]), false, `${names[i]} overlaps ${names[j]}`);
    }
  }
});

test('each rendered building blocks long moves at its visible faces, not empty space', () => {
  const scene = new THREE.Scene();
  const { obstacles } = createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const radius = 0.4;
  for (const name of names) {
    const box = bounds(scene, name);
    const obstacle = obstacles.find((entry) => entry.name === name);
    const x = (box.min.x + box.max.x) / 2;
    const z = (box.min.z + box.max.z) / 2;
    const approaches = [
      { x, z: box.max.z + 2, dx: 0, dz: -10, axis: 'z', face: box.max.z + radius, direction: 1 },
      { x, z: box.min.z - 2, dx: 0, dz: 10, axis: 'z', face: box.min.z - radius, direction: -1 },
      { x: box.max.x + 2, z, dx: -10, dz: 0, axis: 'x', face: box.max.x + radius, direction: 1 },
      { x: box.min.x - 2, z, dx: 10, dz: 0, axis: 'x', face: box.min.x - radius, direction: -1 },
    ];
    for (const approach of approaches) {
      // Isolate each building so an adjacent box cannot mask a missing collision.
      const result = moveWithFarmCollisions(approach.x, approach.z, approach.dx, approach.dz, radius, [obstacle]);
      const gap = (result[approach.axis] - approach.face) * approach.direction;
      assert.ok(gap >= -1e-7 && gap <= 0.101, `${name} stopped ${gap} from its visible face`);
    }
    const clear = moveWithFarmCollisions(box.max.x + radius + 0.2, box.min.z - 2, 0, box.max.z - box.min.z + 4, radius, [obstacle]);
    near(clear.z, box.max.z + 2);
  }
});

test('building boxes do not cover the path, stair treads, pad or spawn', () => {
  const scene = new THREE.Scene();
  const { stairs } = createIsland(scene);
  createFarmLayout(scene);
  scene.updateMatrixWorld(true);
  const buildings = names.map((name) => bounds(scene, name));
  const path = scene.getObjectByName('farm-path');
  const surfaces = path.children.filter((mesh) => mesh.name === 'farm-path-edge' ||
    mesh.name === 'farm-path-surface' || mesh.geometry?.type === 'CircleGeometry');
  assert.equal(surfaces.length, 4);

  for (const surface of surfaces) {
    const positions = surface.geometry.getAttribute('position');
    const indices = surface.geometry.getIndex();
    assert.ok(indices);
    for (let i = 0; i < indices.count; i += 3) {
      const triangle = [0, 1, 2].map((offset) =>
        surface.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + offset))));
      for (const [index, box] of buildings.entries()) {
        assert.equal(triangleOverlapsBox(triangle, box), false, `${names[index]} overlaps the path`);
      }
    }
  }
  for (const step of [...stairs.treads, stairs.footPad]) {
    const stone = new THREE.Box3().setFromObject(step);
    for (const [index, box] of buildings.entries()) {
      assert.equal(rectanglesOverlap(stone, box), false, `${names[index]} overlaps ${step.name}`);
    }
  }
  for (const box of buildings) {
    const x = THREE.MathUtils.clamp(0, box.min.x, box.max.x);
    const z = THREE.MathUtils.clamp(0, box.min.z, box.max.z);
    assert.ok(Math.hypot(x, z) > 0.4, 'building blocks the player at spawn');
  }
});

test('editing each table row moves and resizes its mesh, obstacles and cottage light anchors', () => {
  for (const building of FARM_BUILDINGS) {
    const original = { ...building };
    try {
      Object.assign(building, { x: 0.5, z: 5, width: 1.8, depth: 1.1, height: 1.4 });
      const scene = new THREE.Scene();
      const { windows, obstacles, splashExclusions } = createFarmLayout(scene);
      const character = new THREE.Group();
      scene.add(character);
      const lights = createPracticalLights(character, windows);
      lights.setNightAmount(1);
      scene.updateMatrixWorld(true);
      const box = bounds(scene, building.name);
      near((box.min.x + box.max.x) / 2, building.x);
      near((box.min.z + box.max.z) / 2, building.z);
      near(box.max.x - box.min.x, building.width);
      near(box.max.z - box.min.z, building.depth);
      near(box.max.y - box.min.y, building.height);
      const obstacle = obstacles.find((entry) => entry.name === building.name);
      assertFootprint(box, obstacle);
      assert.deepEqual(splashExclusions.find((entry) => entry.name === building.name), obstacle);

      if (building.name === 'cottage') {
        for (const [index, pane] of windows.entries()) {
          const position = pane.getWorldPosition(new THREE.Vector3());
          near(position.x, building.x + (index === 0 ? -1 : 1) * building.width * 0.3);
          near(position.y, GROUND_HEIGHT + building.height * 0.66);
          near(position.z, box.max.z);
          const light = pane.children.find((child) => child.isPointLight);
          assert.ok(light);
          near(light.getWorldPosition(new THREE.Vector3()).z, box.max.z + 0.7);
          near(light.intensity, 0.85);
          near(pane.material.emissiveIntensity, 0.85);
        }
      }
      assert.equal(character.getObjectByName('lantern').parent, character);
      near(character.getObjectByName('lantern-light').intensity, 0.55);
    } finally {
      Object.assign(building, original);
    }
  }
});
