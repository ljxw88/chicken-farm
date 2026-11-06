import { FARM_PALETTE } from '../scene/farmPalette';
import { BUILDING_PALETTE } from '../scene/farmBuildingMaterials';
import { LANTERN_LIGHT, WINDOW_LIGHT } from '../lighting/dayNightPhases';

// Look Dev's named accent/legacy extension (2026-11-06). The chicken and
// character colours already exist in createFarmDecorations/createCharacter;
// yellow/blue flowers are the two explicitly proposed flower accents. No
// new colours are silently interpolated. At most one accent token per recipe.
export const ASSET_PALETTE = {
  grass: FARM_PALETTE.grass,
  'foliage.mid': FARM_PALETTE.treeFoliage,
  'foliage.light': FARM_PALETTE.treeFoliageLight,
  'foliage.dark': FARM_PALETTE.treeFoliageDark,
  dirt: FARM_PALETTE.dirt,
  'dirt.edge': FARM_PALETTE.dirtEdge,
  'dirt.hi': FARM_PALETTE.dirtHighlight,
  'wood.light': BUILDING_PALETTE.coopWall,
  'wood.mid': FARM_PALETTE.barnWood,
  'wood.dark': FARM_PALETTE.treeTrunk,
  'wood.fence': FARM_PALETTE.barnTrim,
  trunk: FARM_PALETTE.treeTrunk,
  door: FARM_PALETTE.barnDoor,
  timber: BUILDING_PALETTE.timber,
  plaster: BUILDING_PALETTE.plaster,
  roof: FARM_PALETTE.barnRoof,
  'roof.band': BUILDING_PALETTE.shingle,
  stone: BUILDING_PALETTE.stone,
  glass: BUILDING_PALETTE.glass,
  water: FARM_PALETTE.pondWater,
  'water.rim': FARM_PALETTE.pondRim,
  'water.deep': FARM_PALETTE.pondDepth,
  'feather.white': 0xfff1d7,
  'feather.shade': 0xe4d1ae,
  comb: 0xc75b46,
  beak: 0xe9a048,
  'char.yellow': 0xffd477,
  pophole: BUILDING_PALETTE.popHole,
  eye: 0x302820,
  'flower.red': 0xc75b46,
  'flower.yellow': 0xf2c94c,
  'flower.blue': 0x6a8fd0,
  lantern: LANTERN_LIGHT.color,
  'window.glow': WINDOW_LIGHT.color,
} as const;

export const ACCENT_TOKENS = ['flower.red', 'flower.yellow', 'flower.blue', 'lantern', 'window.glow'] as const;
export type PaletteToken = keyof typeof ASSET_PALETTE;
