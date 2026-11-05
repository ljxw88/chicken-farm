import * as THREE from 'three';
import type { WindowPane } from '../lighting/createPracticalLights';
import { GROUND_HEIGHT } from './createScene';
import type { FarmObstacle } from './farmCollisions';
import { FARM_PALETTE } from './farmPalette';

// Positions are shared by the visible props and their collision footprints.
export const FARM_LAYOUT = {
  barn: { x: -3.4, z: -3.4, width: 3.6, depth: 2.8, wallHeight: 2.05, roofRise: 1.2 },
  trees: [
    { x: -2.15, z: 1.55, scale: 0.95 },
    { x: 2.7, z: -0.2, scale: 1 },
    { x: -5.8, z: -0.1, scale: 1.05 },
    { x: 0.05, z: -5.6, scale: 0.95 },
  ],
  pond: { x: 4, z: -3.5, radius: 1.5 },
} as const;

function createPath(group: THREE.Group) {
  const material = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirt, roughness: 1 });
  const path = new THREE.Group();
  path.name = 'farm-path';
  group.add(path);

  function ribbon(points: readonly (readonly [number, number])[], width: number, height: number) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const vertices: number[] = [];
    const indices: number[] = [];
    const segments = 100;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const halfWidth = (width + 0.08 * Math.sin(t * Math.PI * 5)) / 2;
      const nx = -tangent.z * halfWidth;
      const nz = tangent.x * halfWidth;
      vertices.push(point.x + nx, height, point.z + nz, point.x - nx, height, point.z - nz);
      if (i < segments) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    path.add(new THREE.Mesh(geometry, material));

    // Round the end where a path meets the barn or the pond.
    const [endX, endZ] = points[points.length - 1];
    const end = new THREE.Mesh(new THREE.CircleGeometry(width / 2, 20), material);
    end.rotation.x = -Math.PI / 2;
    end.position.set(endX, height + 0.001, endZ);
    path.add(end);
  }

  ribbon([
    [8, 8.2], [4.5, 4.6], [2.4, 2.3], [1.1, 1.1], [0, 0],
    [-0.8, -0.55], [-0.85, -1.45], [-0.3, -2.2], [0.9, -2.55], [2.1, -2.4],
  ], 1.55, GROUND_HEIGHT + 0.004);
  ribbon([
    [-0.75, -1.05], [-1.5, -1.1], [-2.4, -1.15], [-3.4, -1.28],
  ], 1.3, GROUND_HEIGHT + 0.006);
}

function createBarn(group: THREE.Group): WindowPane[] {
  const { x, z, width, depth, wallHeight, roofRise } = FARM_LAYOUT.barn;
  const barn = new THREE.Group();
  barn.name = 'farm-barn';
  barn.position.set(x, GROUND_HEIGHT, z);
  group.add(barn);

  const wood = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnWood, roughness: 1 });
  const plank = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnPlank, roughness: 1 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnRoof, roughness: 1 });
  const doorMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnDoor, roughness: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.barnTrim, roughness: 1 });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), wood);
  walls.position.y = wallHeight / 2;
  barn.add(walls);

  const gableShape = new THREE.Shape();
  gableShape.moveTo(-width / 2, wallHeight);
  gableShape.lineTo(0, wallHeight + roofRise);
  gableShape.lineTo(width / 2, wallHeight);
  gableShape.closePath();
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(gableShape, { depth, bevelEnabled: false }), wood);
  gable.position.z = -depth / 2;
  barn.add(gable);

  const roofAngle = Math.atan2(roofRise, width / 2);
  const roofHalfWidth = width / 2 + 0.2;
  const roofLength = roofHalfWidth / Math.cos(roofAngle);
  const roofGeometry = new THREE.BoxGeometry(roofLength, 0.12, depth + 0.4);
  for (const side of [-1, 1]) {
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
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
  const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.24, 1.75, 7);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeTrunk, roughness: 1 });
  const crowns = [FARM_PALETTE.treeFoliage, FARM_PALETTE.treeFoliageLight, FARM_PALETTE.treeFoliageDark]
    .map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: FARM_PALETTE.shadow, transparent: true, opacity: 0.16, depthWrite: false,
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
    trunk.position.y = 0.875;
    tree.add(trunk);

    const clusters = [
      [0, 2.28, 0, 0.86, 0],
      [-0.48, 2.18, 0.1, 0.65, 1],
      [0.46, 2.2, -0.13, 0.68, 2],
      [0.02, 2.75, 0, 0.64, 1],
    ];
    for (const [cx, cy, cz, size, color] of clusters) {
      const crown = new THREE.Mesh(crownGeometry, crowns[color]);
      crown.position.set(cx, cy, cz);
      crown.scale.set(size, size * 0.9, size);
      tree.add(crown);
    }
  });
}

function createPond(group: THREE.Group) {
  const { x, z } = FARM_LAYOUT.pond;
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
      new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = height;
    pond.add(mesh);
    return mesh;
  }
  blob(1.65, 1.3, 0.005, FARM_PALETTE.pondEdge);
  const water = blob(1.4, 1.05, 0.008, FARM_PALETTE.pondWater);
  water.name = 'farm-pond-water';

  const rippleMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.pondRipple, roughness: 1 });
  for (const [rx, rz, length] of [[-0.55, 0.15, 0.43], [0.25, -0.25, 0.55], [0.65, 0.3, 0.3]]) {
    const ripple = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.035), rippleMaterial);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(rx, 0.01, rz);
    pond.add(ripple);
  }

  const stoneGeometry = new THREE.DodecahedronGeometry(0.14, 0);
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.stone, roughness: 1, flatShading: true });
  for (const [sx, sz, size] of [[-1.3, -0.72, 1], [0.1, -1.23, 0.75], [1.35, 0.62, 0.9], [-0.35, 1.23, 0.8]]) {
    const stone = new THREE.Mesh(stoneGeometry, stoneMaterial);
    stone.position.set(sx, 0.08 * size, sz);
    stone.scale.set(size, 0.6 * size, size);
    pond.add(stone);
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
  const material = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.grassTuft, roughness: 1, flatShading: true });
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
  const obstacles: FarmObstacle[] = [
    {
      kind: 'box', name: 'barn', minX: barn.x - barn.width / 2, maxX: barn.x + barn.width / 2,
      minZ: barn.z - barn.depth / 2, maxZ: barn.z + barn.depth / 2,
    },
    ...trees.map(({ x, z, scale }, index): FarmObstacle => ({
      kind: 'circle', name: `tree-${index + 1}`, x, z, radius: 0.32 * scale,
    })),
    { kind: 'circle', name: 'pond', x: pond.x, z: pond.z, radius: pond.radius },
  ];
  return { windows, obstacles };
}
