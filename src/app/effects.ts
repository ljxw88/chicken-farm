import { CHIMNEY_SMOKE, FIREFLIES } from '../content/effects';
import { VISUAL_SEEDS } from '../content/startup';
import { createVisualRandom } from '../effects/createVisualRandom';
import { EFFECT_ASSETS } from '../render/effectAssets';
import { GROUND_HEIGHT } from '../scene/createScene';
import type { AppContext } from './context';

export function registerEffects(context: AppContext) {
  const { scene, camera, visualSeed } = context;
  context.smoke = EFFECT_ASSETS[CHIMNEY_SMOKE.assetId]({ scene,
    random: visualSeed === undefined ? undefined : createVisualRandom(visualSeed ^ VISUAL_SEEDS.smoke) });
  context.fireflies = EFFECT_ASSETS[FIREFLIES.assetId]({ scene, camera, groundHeight: GROUND_HEIGHT,
    random: visualSeed === undefined ? undefined : createVisualRandom(visualSeed ^ VISUAL_SEEDS.fireflies) });
}

export function updateEffectsFrame(context: AppContext, deltaSeconds: number) {
  const { rainAmount, cloudyAmount } = context.weather.getWeather();
  const nightAmount = context.dayNight.getNightAmount();
  context.smoke.update(deltaSeconds, rainAmount, nightAmount);
  context.fireflies.update(deltaSeconds, nightAmount, rainAmount, cloudyAmount);
}
