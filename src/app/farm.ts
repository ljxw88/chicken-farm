import { createFarmDecorations } from '../render/farmDecorations';
import { createFarmLayout } from '../scene/createFarmLayout';
import { createFarmShadows } from '../scene/createFarmShadows';
import { GROUND_HEIGHT } from '../scene/createScene';
import { createSheepfold } from '../scene/sheepfold/createSheepfold';
import { parseSheepSeed } from '../startupOptions';
import type { AppContext } from './context';

export function registerFarm(context: AppContext) {
  Object.assign(context, createFarmLayout(context.scene));
  const sheepfold = createSheepfold(context.scene, parseSheepSeed(window.location.search));
  context.obstacles.push(...sheepfold.obstacles);
  context.clickTargets.push(...sheepfold.clickTargets);
  context.sheepfold = sheepfold;
  context.decorations = createFarmDecorations(context.scene, GROUND_HEIGHT);
  context.farmShadows = createFarmShadows(context.scene);
}
