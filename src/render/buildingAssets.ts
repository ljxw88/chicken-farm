import { createCottage } from '../scene/createCottage';
import { createRampCoop } from '../scene/createRampCoop';

// Content carries only these IDs and dimensions; Three.js factories live here.
export const BUILDING_ASSETS = {
  'building.cottage': createCottage,
  'building.coop': createRampCoop,
} as const;
