import { createEngine } from '../core/loop';
import { updateClockFrame, updateWeatherFrame } from './environment';
import { updateEffectsFrame } from './effects';
import { updateSkyHudFrame } from './hud';
import type { AppContext, GameComponents } from './context';

export function registerEngine(context: AppContext) {
  context.engine = createEngine<GameComponents>({
    setAnimationLoop: (callback) => context.renderer.setAnimationLoop(callback),
    input: { target: window, canvas: context.canvas, ownMovement: true, ownPlacement: true,
      getPlacement: () => ({ active: context.placement.isActive(), removing: context.placement.isRemoving() }) },
    frameSystems: [
      (world, move, deltaSeconds) => context.controls.system(world, move, Math.min(deltaSeconds, 0.1)),
      (world, _move, deltaSeconds) => {
        updateClockFrame(context, world, deltaSeconds);
        context.follow(context.character.position);
        context.placement.update();
        const nightAmount = updateWeatherFrame(context, world, deltaSeconds);
        updateEffectsFrame(context, deltaSeconds, nightAmount);
        updateSkyHudFrame(context, deltaSeconds);
        context.updateWaterfall(deltaSeconds);
        context.sheepfold.update(deltaSeconds);
      },
    ],
    beforeFrame() {
      // Moving a window between displays can change DPR without a resize event.
      if (window.devicePixelRatio !== context.lastDevicePixelRatio) context.handleResize();
    },
    render: (deltaSeconds) => context.composer.render(deltaSeconds),
  });
}
