export interface CottageSpec {
  assetId: 'building.cottage';
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  roofRise: number;
  roofOverhang: number;
}

export interface CoopSpec extends Omit<CottageSpec, 'assetId'> {
  assetId: 'building.coop';
  floorHeight: number;
  rampWidth: number;
  rampLength: number;
}

// Look Dev lock 4013f658. Heights are relative to GROUND_HEIGHT.
export const FARM_BUILDINGS = [
  { assetId: 'building.cottage', name: 'cottage', x: -3.4, z: -3.4, width: 4.4, depth: 3, height: 2, roofRise: 1.1, roofOverhang: 0.25 },
  { assetId: 'building.coop', name: 'ramp-coop-1', x: 0.15, z: -3.2, width: 1.4, depth: 1.3, height: 1.1,
    floorHeight: 0.35, roofRise: 0.5, roofOverhang: 0.15, rampWidth: 0.6, rampLength: 1.1 },
  { assetId: 'building.coop', name: 'ramp-coop-2', x: 1.35, z: -5, width: 1.4, depth: 1.3, height: 1.1,
    floorHeight: 0.35, roofRise: 0.5, roofOverhang: 0.15, rampWidth: 0.6, rampLength: 1.1 },
] as const satisfies readonly [CottageSpec, CoopSpec, CoopSpec];
