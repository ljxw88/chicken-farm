import { createSheep } from '../scene/sheep/createSheep';
import { createLeanTo } from '../scene/sheepfold/createLeanTo';

// Plain layout IDs resolve here, outside the content records.
export const SHEEPFOLD_ASSETS = {
  'prop.sheep': createSheep,
  'building.sheepfold': createLeanTo,
} as const;
