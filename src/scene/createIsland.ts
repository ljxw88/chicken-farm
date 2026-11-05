import * as THREE from 'three';
import { FARM_PALETTE } from './farmPalette';

// The walkable surface and all four collision boundaries share these dimensions.
export const GROUND_SIZE = 16;
export const GROUND_HEIGHT = 2.4;
export const ISLAND_BOTTOM = 0;
export const VOID_COLOR = 0x101416;

const GRASS_LIP_DEPTH = 0.16;
const SOIL_DEPTH = 0.6;

// Directional samples from the reference video's exposed soil and rock, not
// additional Look Dev LOCKED farm colors. Lighting still affects the materials.
const SOIL_COLORS = [0x573c31, 0x61422e, 0x4a3228, 0x5f3c2b];
const ROCK_COLORS = [0x33454a, 0x334d53, 0x2f3745, 0x334548];

function noise(column: number, row: number, seed: number) {
  let hash = Math.imul(column + 1, 0x9e3779b1) ^ Math.imul(row + 1, 0x85ebca6b) ^ seed;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 0x100000000;
}

function createLayer(
  group: THREE.Group,
  name: string,
  top: number,
  bottom: number,
  colors: readonly number[],
  rows: number,
) {
  const halfSize = GROUND_SIZE / 2;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 });
  // Frame samples are lit screen colors. Lift the soil/rock albedo so the
  // existing farm lighting keeps their rendered hues in the same direction.
  const palette = colors.map((color) => new THREE.Color(color).multiplyScalar(colors.length > 1 ? 2 : 1));
  const average = new THREE.Color(0, 0, 0);
  palette.forEach((color) => average.add(color));
  average.multiplyScalar(1 / palette.length);
  palette.forEach((color) => color.lerp(average, 0.35));
  const sides = [
    { name: 'front', x: 0, z: halfSize, rotation: 0 },
    { name: 'back', x: 0, z: -halfSize, rotation: Math.PI },
    { name: 'right', x: halfSize, z: 0, rotation: Math.PI / 2 },
    { name: 'left', x: -halfSize, z: 0, rotation: -Math.PI / 2 },
  ];

  sides.forEach((side, sideIndex) => {
    // Small, flat facets suggest the mottled cross-section in the frames without
    // applying a screen-space pixel effect or putting extra props on the grass.
    const columns = 32;
    const width = GROUND_SIZE / columns;
    const height = (top - bottom) / rows;
    const positions: number[] = [];
    const normals: number[] = [];
    const vertexColors: number[] = [];
    const seed = (sideIndex + 1) * 157;
    function point(column: number, row: number) {
      const xJitter = column > 0 && column < columns ? (noise(column, row, seed) - 0.5) * width * 0.55 : 0;
      const yJitter = row > 0 && row < rows ? (noise(column, row, seed + 1) - 0.5) * height * 0.35 : 0;
      return [-halfSize + column * width + xJitter, -(top - bottom) / 2 + row * height + yJitter, 0];
    }
    function triangle(vertices: number[][], column: number, row: number, salt: number) {
      const color = palette[Math.floor(noise(column, row, seed + salt) * palette.length)];
      for (const vertex of vertices) {
        positions.push(...vertex);
        normals.push(0, 0, 1);
        vertexColors.push(color.r, color.g, color.b);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = point(column, row);
        const b = point(column + 1, row);
        const c = point(column, row + 1);
        const d = point(column + 1, row + 1);
        if (noise(column, row, seed + 2) < 0.5) {
          triangle([a, b, d], column, row, 3);
          triangle([a, d, c], column, row, 4);
        } else {
          triangle([a, b, c], column, row, 3);
          triangle([b, d, c], column, row, 4);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `island-${name}-${side.name}`;
    mesh.position.set(side.x, (top + bottom) / 2, side.z);
    mesh.rotation.y = side.rotation;
    group.add(mesh);
  });
}

export function createIsland(scene: THREE.Scene) {
  const island = new THREE.Group();
  island.name = 'farm-island';
  scene.add(island);

  // Keep the top separate so pointer raycasts cannot hit the cliff or its void.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: FARM_PALETTE.grass, roughness: 1 }),
  );
  ground.name = 'island-top';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GROUND_HEIGHT;
  island.add(ground);

  const grassBottom = GROUND_HEIGHT - GRASS_LIP_DEPTH;
  const soilBottom = grassBottom - SOIL_DEPTH;
  createLayer(island, 'grass-lip', GROUND_HEIGHT, grassBottom, [FARM_PALETTE.treeFoliageDark], 1);
  createLayer(island, 'soil', grassBottom, soilBottom, SOIL_COLORS, 2);
  createLayer(island, 'rock', soilBottom, ISLAND_BOTTOM, ROCK_COLORS, 4);

  const underside = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(ROCK_COLORS[0]).multiplyScalar(2), roughness: 1 }),
  );
  underside.name = 'island-underside';
  underside.rotation.x = Math.PI / 2;
  underside.position.y = ISLAND_BOTTOM;
  island.add(underside);

  return { island, ground };
}
