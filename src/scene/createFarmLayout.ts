import * as THREE from 'three';
import type { WindowPane } from '../lighting/createPracticalLights';
import { GROUND_HEIGHT, GROUND_SIZE } from './createScene';
import type { FarmObstacle } from './farmCollisions';
import { FARM_PALETTE } from './farmPalette';

// Positions are shared by the visible props and their collision footprints.
export const FARM_LAYOUT = {
  barn: { x: -3.4, z: -3.4, width: 4, depth: 2.6, wallHeight: 2, roofRise: 0.9, roofOverhang: 0.2 },
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

function createBarn(group: THREE.Group): WindowPane[] {
  const { x, z, width, depth, wallHeight, roofRise, roofOverhang } = FARM_LAYOUT.barn;
  const barn = new THREE.Group();
  barn.name = 'farm-barn';
  barn.position.set(x, GROUND_HEIGHT, z);
  group.add(barn);

  const wood = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnWood, roughness: 1 });
  const plank = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnTrim, roughness: 1, transparent: true, opacity: 0.25 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnRoof, roughness: 1 });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnDoor, roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnTrim, roughness: 1 });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), wood);
  walls.name = 'barn-walls';
  walls.position.y = wallHeight / 2;
  barn.add(walls);

  const gableShape = new THREE.Shape();
  gableShape.moveTo(-width / 2, wallHeight);
  gableShape.lineTo(0, wallHeight + roofRise);
  gableShape.lineTo(width / 2, wallHeight);
  gableShape.closePath();
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(gableShape, { depth, bevelEnabled: false }), wood);
  gable.name = 'barn-gable';
  gable.position.z = -depth / 2;
  barn.add(gable);

  const roofAngle = Math.atan2(roofRise, width / 2);
  const roofHalfWidth = width / 2 + roofOverhang;
  const roofLength = roofHalfWidth / Math.cos(roofAngle);
  const roofGeometry = new THREE.BoxGeometry(roofLength, 0.12, depth + roofOverhang * 2);
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.name = 'barn-roof';
    roof.position.set(side * roofHalfWidth / 2, wallHeight + roofRise - roofHalfWidth * Math.tan(roofAngle) / 2, 0);
    roof.rotation.z = -side * roofAngle;
    barn.add(roof);
  }

  // Thin boards add a little texture without changing the low-poly silhouette.
  for (const boardX of [-1.45, -0.9, -0.45, 0, 0.45, 0.9, 1.45]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.025, wallHeight, 0.02), plank);
    board.position.set(boardX, wallHeight / 2, depth / 2 + 0.011);
    barn.add(board);
  }
  for (const boardZ of [-0.9, -0.3, 0.3, 0.9]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.02, wallHeight, 0.025), plank);
    board.position.set(width / 2 + 0.011, wallHeight / 2, boardZ);
    barn.add(board);
  }
  for (const side of [-1, 1]) {
    const corner = new THREE.Mesh(new THREE.BoxGeometry(0.1, wallHeight, 0.08), trim);
    corner.position.set(side * (width / 2 - 0.05), wallHeight / 2, depth / 2 + 0.04);
    barn.add(corner);
  }

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.28, 1.44, 0.06), doorMaterial);
  door.name = 'barn-door';
  door.position.set(0, 0.72, depth / 2 + 0.04);
  barn.add(door);
  for (const side of [-1, 1]) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.05), trim);
    frame.position.set(side * 0.68, 0.75, depth / 2 + 0.08);
    barn.add(frame);

    const brace = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(1.16, 1.25), 0.07, 0.035), trim);
    brace.position.set(0, 0.73, depth / 2 + 0.09);
    brace.rotation.z = side * Math.atan2(1.25, 1.16);
    barn.add(brace);
  }
  const doorTop = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.08, 0.05), trim);
  doorTop.position.set(0, 1.5, depth / 2 + 0.08);
  barn.add(doorTop);

  const loft = new THREE.Mesh(new THREE.CircleGeometry(0.22, 12), doorMaterial);
  loft.position.set(0, wallHeight + 0.43, depth / 2 + 0.02);
  barn.add(loft);

  const windows: WindowPane[] = [];
  for (const [index, windowX] of [-1.2, 1.2].entries()) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.05), trim);
    frame.position.set(windowX, 1.32, depth / 2 + 0.04);
    barn.add(frame);

    const pane: WindowPane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.57, 0.57),
      new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnWindow, roughness: 0.7 }),
    );
    pane.name = `barn-window-${index + 1}`;
    pane.position.set(windowX, 1.32, depth / 2 + 0.071);
    barn.add(pane);
    windows.push(pane);

    for (const [barWidth, barHeight] of [[0.04, 0.6], [0.6, 0.04]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(barWidth, barHeight, 0.025), trim);
      bar.position.set(windowX, 1.32, depth / 2 + 0.09);
      barn.add(bar);
    }
  }

  return windows;
}

function createTrees(group: THREE.Group) {
  const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.24, 1.5, 7);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeTrunk, roughness: 1 });
  const crowns = [FARM_PALETTE.treeFoliage, FARM_PALETTE.treeFoliageLight, FARM_PALETTE.treeFoliageDark]
    .map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: FARM_PALETTE.treeFoliageDark, transparent: true, opacity: 0.16, depthWrite: false,
  });

  FARM_LAYOUT.trees.forEach(({ x, z, scale }, index) => {
    const tree = new THREE.Group();
    tree.name = `farm-tree-${index + 1}`;
    tree.position.set(x, GROUND_HEIGHT, z);
    tree.scale.setScalar(scale);
    group.add(tree);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 16), shadowMaterial);
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

function createGrassTufts(group: THREE.Group) {
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
  let index = 0;
  for (const [x, z] of positions) {
    for (const [offsetX, offsetZ, tilt] of [[-0.08, 0, 0.22], [0.07, 0.03, -0.25], [0, -0.08, 0.08]]) {
      blade.position.set(x + offsetX, GROUND_HEIGHT + 0.13, z + offsetZ);
      blade.rotation.set(0, index * 0.7, tilt);
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
  const windows = createBarn(group);
  createTrees(group);
  createPond(group);
  createGrassTufts(group);

  const { barn, trees, pond } = FARM_LAYOUT;
  const pondObstacle: FarmObstacle = {
    // The 5% margin covers the irregular water outline without blocking its whole oval rim.
    kind: 'box', name: 'pond', minX: pond.x - pond.waterWidth * 0.525, maxX: pond.x + pond.waterWidth * 0.525,
    minZ: pond.z - pond.waterDepth * 0.525, maxZ: pond.z + pond.waterDepth * 0.525,
  };
  const obstacles: FarmObstacle[] = [
    {
      kind: 'box', name: 'barn', minX: barn.x - barn.width / 2, maxX: barn.x + barn.width / 2,
      minZ: barn.z - barn.depth / 2, maxZ: barn.z + barn.depth / 2,
    },
    ...trees.map(({ x, z, scale }, index): FarmObstacle => ({
      kind: 'circle', name: `tree-${index + 1}`, x, z, radius: 0.32 * scale,
    })),
    pondObstacle,
  ];
  const splashExclusions: FarmObstacle[] = [
    {
      kind: 'box', name: 'barn-roof',
      minX: barn.x - barn.width / 2 - barn.roofOverhang, maxX: barn.x + barn.width / 2 + barn.roofOverhang,
      minZ: barn.z - barn.depth / 2 - barn.roofOverhang, maxZ: barn.z + barn.depth / 2 + barn.roofOverhang,
    },
    // Shelter beneath the tree crowns and keep the pond's existing ripples uncluttered.
    ...trees.map(({ x, z, scale }, index): FarmObstacle => ({
      kind: 'circle', name: `tree-canopy-${index + 1}`, x, z, radius: 1.02 * scale,
    })),
    pondObstacle,
  ];
  return { windows, obstacles, splashExclusions };
}
