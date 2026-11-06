import * as THREE from 'three';
import { createFarmBuildings } from './createFarmBuildings';
import { createWaterFeature } from './createWaterFeature';
import { GROUND_HEIGHT, GROUND_SIZE } from './createScene';
import type { FarmObstacle } from './farmCollisions';
import { FARM_PALETTE } from './farmPalette';

// Positions are shared by the visible props and their collision footprints.
export const FARM_LAYOUT = {
  trees: [
    { x: -2.15, z: 1.55, scale: 0.95 },
    { x: 4.8, z: 1.6, scale: 1 },
    { x: -5.8, z: -0.1, scale: 1.05 },
    { x: 0.05, z: -5.6, scale: 0.95 },
  ],
  pond: { x: 4, z: -3.5, width: 3.5, depth: 2.2, waterWidth: 3.1, waterDepth: 1.9 },
} as const;

function createPath(group: THREE.Group) {
  const path = new THREE.Group();
  path.name = 'farm-path';
  group.add(path);
  const points = [
    [-3.4, -1.3], [-2.5, -1.22], [-1.6, -1.1], [-0.75, -0.65], [0, 0],
    [0.85, -0.2], [1.6, -0.9], [2.5, -1.7], [3.4, -1.93], [4.3, -1.95],
    [5.15, -1.65], [6, -0.9], [7.6, 0.4], [8.7, 1.35],
  ];
  // One continuous S-shaped route runs from the barn, past spawn and the pond,
  // to the island edge. The outer ribbon is the darker soil border.
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));

  function ribbon(width: number, height: number, color: number, name: string) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    const vertices: number[] = [];
    const indices: number[] = [];
    const segments = 200;
    const edge = GROUND_SIZE / 2;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const halfWidth = (width + 0.08 * Math.sin(t * Math.PI * 5)) / 2;
      const nx = -tangent.z * halfWidth;
      const nz = tangent.x * halfWidth;
      vertices.push(
        THREE.MathUtils.clamp(point.x + nx, -edge, edge), height, THREE.MathUtils.clamp(point.z + nz, -edge, edge),
        THREE.MathUtils.clamp(point.x - nx, -edge, edge), height, THREE.MathUtils.clamp(point.z - nz, -edge, edge),
      );
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    path.add(mesh);

    // Round the barn end; the other end meets the edge of the island.
    const [endX, endZ] = points[0];
    const end = new THREE.Mesh(new THREE.CircleGeometry(width / 2, 20), material);
    end.rotation.x = -Math.PI / 2;
    end.position.set(endX, height + 0.001, endZ);
    path.add(end);
  }

  ribbon(1.34, GROUND_HEIGHT + 0.02, FARM_PALETTE.dirtEdge, 'farm-path-edge');
  ribbon(1.2, GROUND_HEIGHT + 0.024, FARM_PALETTE.dirt, 'farm-path-surface');

  const highlight = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirtHighlight, roughness: 1 });
  for (const [index, t] of [0.055, 0.1, 0.145, 0.19, 0.235, 0.28, 0.33, 0.39, 0.46, 0.53, 0.61, 0.7, 0.8, 0.9].entries()) {
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const offset = [0.38, -0.32, 0.18][index % 3];
    const x = point.x - tangent.z * offset;
    const z = point.z + tangent.x * offset;
    if (Math.abs(x) > GROUND_SIZE / 2 - 0.15 || Math.abs(z) > GROUND_SIZE / 2 - 0.15) continue;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(index % 3 === 0 ? 0.19 : 0.13, 0.065), highlight);
    dash.name = 'farm-path-highlight';
    dash.rotation.x = -Math.PI / 2;
    dash.rotateZ(Math.atan2(-tangent.z, tangent.x) + (index % 2 === 0 ? 0.2 : -0.2));
    dash.position.set(x, GROUND_HEIGHT + 0.027, z);
    path.add(dash);
  }
}

function createTrees(group: THREE.Group) {
  const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.24, 1.5, 7);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeTrunk, roughness: 1 });
  const crowns = [FARM_PALETTE.treeFoliage, FARM_PALETTE.treeFoliageLight, FARM_PALETTE.treeFoliageDark]
    .map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  const shadowMaterial = new THREE.MeshBasicMaterial({
    // A shadow must darken even when the surrounding night ground is dark.
    color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false,
  });

  FARM_LAYOUT.trees.forEach(({ x, z, scale }, index) => {
    const tree = new THREE.Group();
    tree.name = `farm-tree-${index + 1}`;
    tree.position.set(x, GROUND_HEIGHT, z);
    tree.scale.setScalar(scale);
    group.add(tree);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), shadowMaterial);
    shadow.name = `farm-tree-shadow-${index + 1}`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.y = 0.72;
    shadow.position.y = 0.003;
    tree.add(shadow);

    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.name = `farm-tree-trunk-${index + 1}`;
    trunk.position.y = 0.75;
    tree.add(trunk);

    const clusters = [
      [0, 2.05, 0, 0.85, 0],
      [-0.4, 1.95, 0.1, 0.62, 1],
      [0.4, 1.98, -0.1, 0.62, 2],
      [0.02, 2.4, 0, 0.5, 1],
    ];
    for (const [cx, cy, cz, size, color] of clusters) {
      const crown = new THREE.Mesh(crownGeometry, crowns[color]);
      crown.position.set(cx, cy, cz);
      crown.scale.set(size, size * 0.8, size);
      tree.add(crown);
    }
  });
}

function createPond(group: THREE.Group) {
  const { x, z, width, depth, waterWidth, waterDepth } = FARM_LAYOUT.pond;
  const pond = new THREE.Group();
  pond.name = 'farm-pond';
  pond.position.set(x, GROUND_HEIGHT, z);
  group.add(pond);

  const outline = [1, 0.96, 1.04, 1.02, 0.95, 1.03, 1.04, 0.95, 1.02, 1.05, 0.96, 1.02, 1.04, 0.96];
  function blob(radiusX: number, radiusZ: number, height: number, color: number) {
    const shape = new THREE.Shape();
    outline.forEach((variation, i) => {
      const angle = i / outline.length * Math.PI * 2;
      const px = Math.cos(angle) * radiusX * variation;
      const py = Math.sin(angle) * radiusZ * variation;
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    });
    shape.closePath();
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color, roughness: 0.25 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = height;
    pond.add(mesh);
    return mesh;
  }
  const rim = blob(width / 2, depth / 2, 0.027, FARM_PALETTE.pondRim);
  rim.name = 'farm-pond-rim';
  const water = blob(waterWidth / 2, waterDepth / 2, 0.029, FARM_PALETTE.pondWater);
  water.name = 'farm-pond-water';
  const deepWater = blob(0.85, 0.5, 0.03, FARM_PALETTE.pondDepth);
  deepWater.name = 'farm-pond-depth';
  deepWater.position.x = 0.2;
  deepWater.position.z = -0.08;

  const rippleMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.pondRim, roughness: 0.25 });
  for (const [rx, rz, length] of [[-0.55, 0.15, 0.43], [0.25, -0.25, 0.55], [0.65, 0.3, 0.3]]) {
    const ripple = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.035), rippleMaterial);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(rx, 0.032, rz);
    pond.add(ripple);
  }
}

function createGrassTufts(group: THREE.Group, stream: THREE.CatmullRomCurve3) {
  const positions = [
    [-6.2, 2.5], [-3.8, 2.65], [-2.6, 3.1], [-0.8, 2.8], [1, 3.4], [3.5, 1.5],
    [5.4, 1.3], [6.2, -1.4], [6, -5.7], [2.9, -6.3], [1.3, -6.8], [-2.2, -5.7],
    [-6.5, -4.7], [-7.2, -1.6], [-6.8, 0.9], [-2.9, 0.35], [3, 0.85], [1.9, -4.8],
    [-0.75, -3.8], [4.8, 3.7], [-4.9, 4.4], [7.5, -3.4], [-7.5, 3.8], [0.4, 5],
  ];
  const geometry = new THREE.ConeGeometry(0.055, 0.28, 3);
  const material = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeFoliageDark, roughness: 1, flatShading: true });
  const tufts = new THREE.InstancedMesh(geometry, material, positions.length * 3);
  tufts.name = 'farm-grass-tufts';
  const blade = new THREE.Object3D();
  const centerline = stream.getSpacedPoints(400);
  let index = 0;
  for (const [x, z] of positions) {
    const hidden = centerline.some((point) => Math.hypot(point.x - x, point.z - z) < 0.9);
    for (const [offsetX, offsetZ, tilt] of [[-0.08, 0, 0.22], [0.07, 0.03, -0.25], [0, -0.08, 0.08]]) {
      blade.position.set(x + offsetX, GROUND_HEIGHT + 0.13, z + offsetZ);
      blade.rotation.set(0, index * 0.7, tilt);
      blade.scale.setScalar(hidden ? 0 : 1);
      blade.updateMatrix();
      tufts.setMatrixAt(index++, blade.matrix);
    }
  }
  group.add(tufts);
}

export function createFarmLayout(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.name = 'farm-layout';
  scene.add(group);
  createPath(group);
  const { windows, extraEmissives, obstacles: buildingObstacles, splashExclusions: buildingShelters } = createFarmBuildings(group);
  createTrees(group);
  createPond(group);
  const water = createWaterFeature(group);
  createGrassTufts(group, water.curve);

  const { trees, pond } = FARM_LAYOUT;
  const pondObstacle: FarmObstacle = {
    // The 5% margin covers the irregular water outline without blocking its whole oval rim.
    kind: 'box', name: 'pond', minX: pond.x - pond.waterWidth * 0.525, maxX: pond.x + pond.waterWidth * 0.525,
    minZ: pond.z - pond.waterDepth * 0.525, maxZ: pond.z + pond.waterDepth * 0.525,
  };
  const obstacles: FarmObstacle[] = [
    ...buildingObstacles,
    ...trees.map(({ x, z, scale }, index): FarmObstacle => ({
      kind: 'circle', name: `tree-${index + 1}`, x, z, radius: 0.32 * scale,
    })),
    pondObstacle,
    ...water.obstacles,
  ];
  const splashExclusions: FarmObstacle[] = [
    ...buildingShelters,
    // Shelter beneath the tree crowns and keep the pond's existing ripples uncluttered.
    ...trees.map(({ x, z, scale }, index): FarmObstacle => ({
      kind: 'circle', name: `tree-canopy-${index + 1}`, x, z, radius: 1.02 * scale,
    })),
    pondObstacle,
    ...water.splashExclusions,
  ];
  return { windows, extraEmissives, obstacles, splashExclusions, bridgeHeight: water.bridgeHeight, updateWaterfall: water.updateWaterfall };
}
