import { ART_SLOTS, FARM_PALETTE } from '../content/slots';
import { LANTERN_LIGHT } from '../content/dayNight';

// Look Dev's approved named extensions (ASSET-BRIEF.md, 2026-11-06): flower
// colours, pumpkins, existing lantern metal, and lantern glass. Wool and animal
// tokens are intentionally excluded from EBR-83..85 / this PR.
export const ASSET_PALETTE = {
  grass: FARM_PALETTE.grass,
  'foliage.mid': FARM_PALETTE.treeFoliage,
  'foliage.light': FARM_PALETTE.treeFoliageLight,
  'foliage.dark': FARM_PALETTE.treeFoliageDark,
  dirt: FARM_PALETTE.dirt,
  'dirt.edge': FARM_PALETTE.dirtEdge,
  'dirt.hi': FARM_PALETTE.dirtHighlight,
  soil: FARM_PALETTE.soil,
  'wood.light': ART_SLOTS.building.coop.wall,
  'wood.mid': FARM_PALETTE.barnWood,
  'wood.dark': FARM_PALETTE.treeTrunk,
  'wood.fence': FARM_PALETTE.barnTrim,
  trunk: FARM_PALETTE.treeTrunk,
  door: FARM_PALETTE.barnDoor,
  timber: ART_SLOTS.building.cottage.timber,
  plaster: ART_SLOTS.building.cottage.plaster,
  roof: FARM_PALETTE.barnRoof,
  'roof.band': ART_SLOTS.building.cottage.shingle,
  stone: ART_SLOTS.building.cottage.stone,
  glass: ART_SLOTS.building.cottage.glass,
  water: FARM_PALETTE.pondWater,
  'water.rim': FARM_PALETTE.pondRim,
  'water.deep': FARM_PALETTE.pondDepth,
  'flower.red': FARM_PALETTE.flowerRed,
  'flower.yellow': FARM_PALETTE.flowerYellow,
  'flower.blue': FARM_PALETTE.flowerBlue,
  'flower.orange': FARM_PALETTE.flowerOrange,
  pumpkin: 0xd9822b,
  metal: ART_SLOTS.palette.lantern.metal,
  'lantern.glow': LANTERN_LIGHT.color,
} as const;

export const ACCENT_TOKENS = ['flower.red', 'flower.yellow', 'flower.blue', 'flower.orange', 'pumpkin', 'lantern.glow'] as const;
export type PaletteToken = keyof typeof ASSET_PALETTE;
