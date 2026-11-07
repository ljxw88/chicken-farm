import { createFarmHud } from '../ui';
import type { AppContext } from './context';

export function registerHud(context: AppContext) {
  context.farmHud = createFarmHud({ root: context.hudRoot, initialPhase: context.dayNight.getPhase() });
}
