import * as THREE from 'three';
import type { FarmObstacle } from '../character/farmCollisions';
import { intersectsFootprint, type Cell } from '../placement/grid';
import type { GroundGrid } from '../world/ground';

const PATH_ID = 'ground:path';
const WATER_ID = 'ground:water';

/** Classify the authored ribbon without changing its meshes or materials. */
function pathCells(grid: GroundGrid, scene: THREE.Scene): Cell[] {
  const path = scene.getObjectByName('farm-path');
  const edge = scene.getObjectByName('farm-path-edge');
  if (!path || !(edge instanceof THREE.Mesh)) return [];
  const triangles: { triangle: THREE.Triangle; minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number }[] = [];
  path.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.material !== edge.material) return;
    object.updateWorldMatrix(true, false);
    const position = object.geometry.getAttribute('position');
    const index = object.geometry.getIndex();
    if (!position) return;
    const count = index?.count ?? position.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const vertex = (offset: number) => new THREE.Vector3().fromBufferAttribute(position, index ? index.getX(i + offset) : i + offset)
        .applyMatrix4(object.matrixWorld);
      const triangle = new THREE.Triangle(vertex(0), vertex(1), vertex(2));
      const points = [triangle.a, triangle.b, triangle.c];
      triangles.push({ triangle, minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)),
        minZ: Math.min(...points.map((point) => point.z)), maxZ: Math.max(...points.map((point) => point.z)),
        minY: Math.min(...points.map((point) => point.y)) - 1, maxY: Math.max(...points.map((point) => point.y)) + 1 });
    }
  });
  return grid.cells().filter((cell) => {
    const { minX, maxX, minZ, maxZ } = grid.cellBounds(cell);
    const box = new THREE.Box3(new THREE.Vector3(minX, -1, minZ), new THREE.Vector3(maxX, 1, maxZ));
    return triangles.some(({ triangle, minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY, maxY }) => {
      if (x1 < minX || x0 > maxX || z1 < minZ || z0 > maxZ) return false;
      // Only the X/Z projection matters; choose a finite Y range around the triangle.
      box.min.y = minY;
      box.max.y = maxY;
      return box.intersectsTriangle(triangle);
    });
  });
}

function waterCells(grid: GroundGrid, obstacles: readonly FarmObstacle[]): Cell[] {
  const water = obstacles.filter(({ name }) => name === 'pond' || name.startsWith('stream-water-'));
  return grid.cells().filter((cell) => {
    const bounds = grid.cellBounds(cell);
    const area = { ...bounds, cell, columns: 1, rows: 1,
      centerX: (bounds.minX + bounds.maxX) / 2, centerZ: (bounds.minZ + bounds.maxZ) / 2 };
    return water.some((obstacle) => intersectsFootprint(area, obstacle));
  });
}

/** The grid labels are derived from existing data/geometry; gameplay still owns the obstacles. */
export function createFarmTerrain(grid: GroundGrid, scene: THREE.Scene, getObstacles: () => readonly FarmObstacle[]) {
  function refreshWater() {
    grid.setOccupant({ id: WATER_ID, kind: 'water', blocksPlacement: true, cells: waterCells(grid, getObstacles()) });
  }
  function refresh() {
    grid.setOccupant({ id: PATH_ID, kind: 'path', blocksPlacement: false, cells: pathCells(grid, scene) });
    refreshWater();
  }
  refresh();
  const unsubscribe = grid.onChange((change) => { if (change.type === 'chunk-added') refresh(); });
  return { refresh, refreshWater, dispose: unsubscribe };
}
