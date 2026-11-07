import type { FarmObstacle } from '../character/farmCollisions';

export function buildingFootprint(name: string, x: number, z: number, width: number, depth: number): FarmObstacle {
  return { kind: 'box', name, minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}
