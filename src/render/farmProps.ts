import * as THREE from 'three';
import { createWaterFeature } from '../scene/createWaterFeature';
import { GROUND_HEIGHT, GROUND_SIZE } from '../scene/createScene';
import { ART_SLOTS, FARM_PALETTE } from '../content/slots';
import type { FarmLayout } from '../content/farm';
import { GRASS_GEOMETRY, PATH_GEOMETRY, POND_GEOMETRY, TREE_GEOMETRY } from '../content/propGeometry';

function createPath(group: THREE.Group, spec: FarmLayout['path']) {
  const path = new THREE.Group();
  path.name = 'farm-path';
  group.add(path);
  const points = spec.points;
  // One continuous S-shaped route runs from the barn, past spawn and the pond,
  // to the island edge. The outer ribbon is the darker soil border.
  const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)));

  function ribbon(width: number, height: number, color: number, name: string) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    const vertices: number[] = [];
    const indices: number[] = [];
    const segments = PATH_GEOMETRY.segments;
    const edge = GROUND_SIZE / 2;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t);
      const halfWidth = (width + PATH_GEOMETRY.widthWave * Math.sin(t * Math.PI * PATH_GEOMETRY.waveCount)) / 2;
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

    // Tight bends can fold the inside edge of the ribbon. Keep every
    // nondegenerate triangle front-facing from above before computing normals.
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3;
      const b = indices[i + 1] * 3;
      const c = indices[i + 2] * 3;
      const normalY = (vertices[b + 2] - vertices[a + 2]) * (vertices[c] - vertices[a]) -
        (vertices[b] - vertices[a]) * (vertices[c + 2] - vertices[a + 2]);
      if (normalY < 0) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
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
    const end = new THREE.Mesh(new THREE.CircleGeometry(width / 2, PATH_GEOMETRY.endSegments), material);
    end.rotation.x = -Math.PI / 2;
    end.position.set(endX, height + PATH_GEOMETRY.endLift, endZ);
    path.add(end);
  }

  ribbon(PATH_GEOMETRY.edgeWidth, GROUND_HEIGHT + PATH_GEOMETRY.edgeLift, FARM_PALETTE.dirtEdge, 'farm-path-edge');
  ribbon(PATH_GEOMETRY.surfaceWidth, GROUND_HEIGHT + PATH_GEOMETRY.surfaceLift, FARM_PALETTE.dirt, 'farm-path-surface');

  const highlight = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.dirtHighlight, roughness: 1 });
  for (const [index, t] of PATH_GEOMETRY.highlightPositions.entries()) {
    const point = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const offset = PATH_GEOMETRY.highlightOffsets[index % 3];
    const x = point.x - tangent.z * offset;
    const z = point.z + tangent.x * offset;
    if (Math.abs(x) > GROUND_SIZE / 2 - PATH_GEOMETRY.highlightEdgeClearance || Math.abs(z) > GROUND_SIZE / 2 - PATH_GEOMETRY.highlightEdgeClearance) continue;
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(index % 3 === 0 ? PATH_GEOMETRY.highlightLongWidth : PATH_GEOMETRY.highlightWidth,
      PATH_GEOMETRY.highlightDepth), highlight);
    dash.name = 'farm-path-highlight';
    dash.rotation.x = -Math.PI / 2;
    dash.rotateZ(Math.atan2(-tangent.z, tangent.x) + (index % 2 === 0 ? PATH_GEOMETRY.highlightAngle : -PATH_GEOMETRY.highlightAngle));
    dash.position.set(x, GROUND_HEIGHT + PATH_GEOMETRY.highlightLift, z);
    path.add(dash);
  }
}

function createTrees(group: THREE.Group, trees: FarmLayout['trees']) {
  const trunkGeometry = new THREE.CylinderGeometry(...TREE_GEOMETRY.trunk);
  const crownGeometry = new THREE.IcosahedronGeometry(...TREE_GEOMETRY.crown);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeTrunk, roughness: 1 });
  const crowns = [FARM_PALETTE.treeFoliage, FARM_PALETTE.treeFoliageLight, FARM_PALETTE.treeFoliageDark]
    .map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: ART_SLOTS.palette.contactShadow, transparent: true, opacity: ART_SLOTS.light.contact.treeOpacity, depthWrite: false,
  });

  trees.forEach(({ x, z, scale }, index) => {
    const tree = new THREE.Group();
    tree.name = `farm-tree-${index + 1}`;
    tree.position.set(x, GROUND_HEIGHT, z);
    tree.scale.setScalar(scale);
    group.add(tree);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(TREE_GEOMETRY.shadowRadius, TREE_GEOMETRY.shadowSegments), shadowMaterial);
    shadow.name = `farm-tree-shadow-${index + 1}`;
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.y = TREE_GEOMETRY.shadowScale;
    shadow.position.y = TREE_GEOMETRY.shadowLift;
    tree.add(shadow);

    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.name = `farm-tree-trunk-${index + 1}`;
    trunk.position.y = TREE_GEOMETRY.trunkY;
    tree.add(trunk);

    for (const [cx, cy, cz, size, color] of TREE_GEOMETRY.clusters) {
      const crown = new THREE.Mesh(crownGeometry, crowns[color]);
      crown.position.set(cx, cy, cz);
      crown.scale.set(size, size * TREE_GEOMETRY.crownHeightScale, size);
      tree.add(crown);
    }
  });
}

function createPond(group: THREE.Group, spec: FarmLayout['pond']) {
  const { x, z, width, depth, waterWidth, waterDepth } = spec;
  const pond = new THREE.Group();
  pond.name = 'farm-pond';
  pond.position.set(x, GROUND_HEIGHT, z);
  group.add(pond);

  const outline = POND_GEOMETRY.outline;
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
  const rim = blob(width / 2, depth / 2, POND_GEOMETRY.rimLift, FARM_PALETTE.pondRim);
  rim.name = 'farm-pond-rim';
  const water = blob(waterWidth / 2, waterDepth / 2, POND_GEOMETRY.waterLift, FARM_PALETTE.pondWater);
  water.name = 'farm-pond-water';
  const deepWater = blob(POND_GEOMETRY.deepRadiusX, POND_GEOMETRY.deepRadiusZ, POND_GEOMETRY.deepLift, FARM_PALETTE.pondDepth);
  deepWater.name = 'farm-pond-depth';
  deepWater.position.x = POND_GEOMETRY.deepX;
  deepWater.position.z = POND_GEOMETRY.deepZ;

  const rippleMaterial = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.pondRim, roughness: 0.25 });
  for (const [rx, rz, length] of POND_GEOMETRY.ripples) {
    const ripple = new THREE.Mesh(new THREE.PlaneGeometry(length, POND_GEOMETRY.rippleWidth), rippleMaterial);
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(rx, POND_GEOMETRY.rippleLift, rz);
    pond.add(ripple);
  }
}

function createGrassTufts(group: THREE.Group, spec: FarmLayout['grass'], stream: THREE.CatmullRomCurve3) {
  const positions = spec.positions;
  const geometry = new THREE.ConeGeometry(...GRASS_GEOMETRY.blade);
  const material = new THREE.MeshStandardMaterial({ color: FARM_PALETTE.treeFoliageDark, roughness: 1, flatShading: true });
  const tufts = new THREE.InstancedMesh(geometry, material, positions.length * GRASS_GEOMETRY.offsets.length);
  tufts.name = 'farm-grass-tufts';
  const blade = new THREE.Object3D();
  const centerline = stream.getSpacedPoints(GRASS_GEOMETRY.centerlineSamples);
  let index = 0;
  for (const [x, z] of positions) {
    const hidden = centerline.some((point) => Math.hypot(point.x - x, point.z - z) < GRASS_GEOMETRY.streamClearance);
    for (const [offsetX, offsetZ, tilt] of GRASS_GEOMETRY.offsets) {
      blade.position.set(x + offsetX, GROUND_HEIGHT + GRASS_GEOMETRY.lift, z + offsetZ);
      blade.rotation.set(0, index * GRASS_GEOMETRY.rotationStep, tilt);
      blade.scale.setScalar(hidden ? 0 : 1);
      blade.updateMatrix();
      tufts.setMatrixAt(index++, blade.matrix);
    }
  }
  group.add(tufts);
}

// IDs in content resolve only here, not to renderer objects in game data.
export const FARM_PROP_ASSETS = {
  'prop.path': createPath,
  'prop.tree': createTrees,
  'prop.pond': createPond,
  'prop.water-feature': createWaterFeature,
  'prop.grass': createGrassTufts,
} as const;
