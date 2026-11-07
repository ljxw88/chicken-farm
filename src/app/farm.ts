import { createFarmDecorations } from '../render/farmDecorations';
import { createFarmLayout } from '../scene/createFarmLayout';
import { createFarmShadows } from '../scene/createFarmShadows';
import { ART_SLOTS } from '../content/slots';
import { GROUND_HEIGHT } from '../scene/createScene';
import { createSheepfold } from '../scene/sheepfold/createSheepfold';
import { parseSeason, parseSheepSeed } from '../startupOptions';
import type { AppContext } from './context';

export function registerFarm(context: AppContext) {
  context.season = parseSeason(window.location.search);
  Object.assign(context, createFarmLayout(context.scene, undefined, ART_SLOTS.palette.season[context.season].crown));
  const sheepfold = createSheepfold(context.scene, parseSheepSeed(window.location.search));
  context.obstacles.push(...sheepfold.obstacles);
  context.clickTargets.push(...sheepfold.clickTargets);
  context.sheepfold = sheepfold;
}

export function registerFarmDecorations(context: AppContext) {
  context.decorations = createFarmDecorations(context.scene, GROUND_HEIGHT);
  context.farmShadows = createFarmShadows(context.scene);
}
