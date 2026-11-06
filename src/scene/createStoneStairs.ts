import * as THREE from 'three';
import type { FarmBoundarySlide, FarmBounds } from '../character/farmCollisions';
import {
  createStairSurface, stairSupports, slideStairPadCorner, stairFloorHeight, stairCharacterHeight, stairTarget,
  STAIR_CENTER_Z, STAIR_WIDTH, TREAD_DEPTH, TREAD_COUNT, PAD_LENGTH, PAD_WIDTH, PAD_HEIGHT,
  type StairSurface,
} from '../character/stairSurface';
import { FARM_PALETTE } from './farmPalette';

const EDGE_DEPTH = 0.18;
const TREAD_MIXES = [0.76, 0.82, 0.78, 0.84, 0.8];

export interface StoneStairs {
  treads: THREE.Mesh[];
  footPad: THREE.Mesh;
  surface: StairSurface;
  bounds: FarmBounds;
  supports(x: number, z: number, radius: number): boolean;
  slidePadCorner: FarmBoundarySlide;
  floorHeight(x: number): number;
  characterHeight(x: number, radius: number): number;
  target(x: number, z: number, radius: number): { x: number; z: number };
}

export function createStoneStairs(island: THREE.Group, size: number, top: number, bottom: number): StoneStairs {
  const surface = createStairSurface(size, top, bottom);
  const { edge, padStart, padEnd, rise } = surface;
  const stairs = new THREE.Group();
  stairs.name = 'island-stone-stairs';
  island.add(stairs);

  // Derive the stone from the existing barn wall and dirt path, not a new
  // palette. Subtle top variations and a wider-than-one-pixel edge survive the
  // pixel pass without emissive light or a change to the locked lighting.
  const barn = new THREE.Color(FARM_PALETTE.barnWood);
  const dirt = new THREE.Color(FARM_PALETTE.dirt);
  const stone = new THREE.MeshStandardMaterial({ color: dirt.clone().lerp(barn, 0.18), roughness: 1 });

  function block(length: number, height: number, width: number, mix: number) {
    const color = dirt.clone().lerp(barn, mix);
    const tread = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    const tint = new THREE.MeshStandardMaterial({ color: color.clone().lerp(barn, 0.5).multiplyScalar(1.1), roughness: 1 });
    const geometry = new THREE.BoxGeometry(length, height, width, Math.round(length / EDGE_DEPTH), 1, 1);
    const groups = geometry.groups.slice();
    geometry.clearGroups();
    for (const group of groups) {
      if (group.materialIndex === 2) {
        // The last top-face segment is the camera-facing +X tread edge.
        geometry.addGroup(group.start, group.count - 6, 2);
        geometry.addGroup(group.start + group.count - 6, 6, 6);
      } else {
        geometry.addGroup(group.start, group.count, group.materialIndex);
      }
    }
    return new THREE.Mesh(geometry, [stone, stone, tread, stone, stone, stone, tint]);
  }

  const treads = Array.from({ length: TREAD_COUNT }, (_, index) => {
    const height = top - index * rise - bottom;
    const step = block(TREAD_DEPTH, height, STAIR_WIDTH, TREAD_MIXES[index]);
    step.name = `stone-step-${index + 1}`;
    step.position.set(edge + (index + 0.5) * TREAD_DEPTH, bottom + height / 2, STAIR_CENTER_Z);
    stairs.add(step);
    return step;
  });

  // Part of this small pad sits beneath the lowest block, so it visibly has a
  // foot without adding another island or lower terrace.
  const footPad = block(PAD_LENGTH, PAD_HEIGHT, PAD_WIDTH, 0.78);
  footPad.name = 'stone-foot-pad';
  footPad.position.set((padStart + padEnd) / 2, bottom + PAD_HEIGHT / 2, STAIR_CENTER_Z);
  stairs.add(footPad);

  // The scene and shadow adapters delegate to the same plain-data surface used
  // by the character systems; the meshes themselves remain render-only.
  return {
    treads, footPad, surface, bounds: surface.bounds,
    supports: (x, z, radius) => stairSupports(surface, x, z, radius),
    slidePadCorner: (x, z, radius, distance) => slideStairPadCorner(surface, x, z, radius, distance),
    floorHeight: (x) => stairFloorHeight(surface, x),
    characterHeight: (x, radius) => stairCharacterHeight(surface, x, radius),
    target: (x, z, radius) => stairTarget(surface, x, z, radius),
  };
}
