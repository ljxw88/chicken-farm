export type AssetCategory = 'prop' | 'flora' | 'animal' | 'building' | 'terrain';
export type Vec3 = [number, number, number];

export interface PartBase {
  name: string;
  mat: string;
  at: Vec3;
  /** Euler angles in degrees. */
  rot?: Vec3;
  scale?: Vec3;
  feature?: string;
  exception?: 'band' | 'cleat';
  polygonOffset?: boolean;
  seed?: number;
  jitter?: { position?: number; rotation?: number };
}

export type AssetPart = PartBase & (
  | { prim: 'box' | 'bevelBox'; size: Vec3; bevel?: number }
  | { prim: 'cylinder'; radiusTop: number; radiusBottom: number; h: number; segments: number }
  | { prim: 'cone'; radius: number; h: number; segments: number }
  | { prim: 'sphere'; radius: number; detail: 0 | 1 }
  | { prim: 'capsule'; radius: number; length: number; segments: number }
  | { prim: 'wedge'; size: Vec3 }
  | { prim: 'lathe'; profile: [number, number][]; segments: number }
  | { prim: 'extrude'; polygon: [number, number][]; depth: number }
  | { prim: 'custom'; positions: number[]; indices: number[] }
);

export interface AssetRecipe {
  id: string;
  category: AssetCategory;
  footprint: { w: number; d: number };
  height: number;
  origin: 'base-center';
  facing: '+Z';
  parts: AssetPart[];
  anchors: Record<string, Vec3>;
  emissive: { part: string; mat: string; strength: number }[];
  collision: { type: 'box'; w: number; d: number; h: number } | { type: 'none' };
  slots: Record<string, string>;
  tags: string[];
  proposedTokens?: string[];
}
