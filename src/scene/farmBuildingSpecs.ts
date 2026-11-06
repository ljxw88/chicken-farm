import type { FarmObstacle } from '../character/farmCollisions';

export interface CottageSpec {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  roofRise: number;
  roofOverhang: number;
}

export interface CoopSpec extends CottageSpec {
  floorHeight: number;
  rampWidth: number;
  rampLength: number;
}

// Look Dev lock 4013f658. Heights are relative to GROUND_HEIGHT.
export const FARM_BUILDINGS = [
  { name: 'cottage', x: -3.4, z: -3.4, width: 4.4, depth: 3, height: 2, roofRise: 1.1, roofOverhang: 0.25 },
  { name: 'ramp-coop-1', x: 0.15, z: -3.2, width: 1.4, depth: 1.3, height: 1.1,
    floorHeight: 0.35, roofRise: 0.5, roofOverhang: 0.15, rampWidth: 0.6, rampLength: 1.1 },
  { name: 'ramp-coop-2', x: 1.35, z: -5, width: 1.4, depth: 1.3, height: 1.1,
    floorHeight: 0.35, roofRise: 0.5, roofOverhang: 0.15, rampWidth: 0.6, rampLength: 1.1 },
] as const satisfies readonly [CottageSpec, CoopSpec, CoopSpec];

export function buildingFootprint(name: string, x: number, z: number, width: number, depth: number): FarmObstacle {
  return { kind: 'box', name, minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}
