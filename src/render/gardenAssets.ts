import { createBeehives } from '../scene/gardenDressing/createBeehives';
import { createFlowerPatches } from '../scene/gardenDressing/createFlowerPatches';

// Plain layout IDs resolve to rendering factories outside the content records.
export const GARDEN_ASSETS = {
  'prop.beehives': createBeehives,
  'prop.flower-patches': createFlowerPatches,
} as const;
