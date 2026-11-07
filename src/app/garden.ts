import { createGardenDressing } from '../scene/gardenDressing/createGardenDressing';
import type { AppContext } from './context';

export function registerGarden(context: AppContext) {
  const garden = createGardenDressing(context.scene);
  context.obstacles.push(...garden.obstacles);
  context.clickTargets.push(...garden.clickTargets);
  context.garden = garden;
}
