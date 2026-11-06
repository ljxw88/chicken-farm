import type * as THREE from 'three';

export interface AssetMeta {
  id: string;
  category: 'trees' | 'rocks' | 'fences' | 'props' | 'farm';
  footprint: { width: number; depth: number };
  height: number;
  palette: readonly string[];
  triBudget: number;
}

export interface AssetModule {
  meta: AssetMeta;
  build(): THREE.Group;
}
