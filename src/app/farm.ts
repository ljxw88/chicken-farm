import { createFarmDecorations } from '../render/farmDecorations';
import { createFarmLayout } from '../scene/createFarmLayout';
import { createFarmShadows } from '../scene/createFarmShadows';
import { GROUND_HEIGHT } from '../scene/createScene';
import { createSheepfold } from '../scene/sheepfold/createSheepfold';
import { parseSheepSeed } from '../startupOptions';
import { createFarmTerrain } from './farmTerrain';
import type { AppContext } from './context';

export function registerFarm(context: AppContext) {
  Object.assign(context, createFarmLayout(context.scene));
  if (context.groundGrid) context.farmTerrain = createFarmTerrain(context.groundGrid, context.scene, () => context.obstacles);
  const sheepfold = createSheepfold(context.scene, parseSheepSeed(window.location.search));
  context.obstacles.push(...sheepfold.obstacles);
  context.clickTargets.push(...sheepfold.clickTargets);
  context.sheepfold = sheepfold;
}

export function registerFarmDecorations(context: AppContext) {
  context.decorations = createFarmDecorations(context.scene, GROUND_HEIGHT);
  context.farmShadows = createFarmShadows(context.scene);
}
