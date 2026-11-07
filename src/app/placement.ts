import { createPlacementAdapter } from '../placement';
import { STARTUP_OPTIONS } from '../content/startup';
import { GROUND_HEIGHT, GROUND_SIZE } from '../scene/createScene';
import type { AppContext } from './context';

export function registerPlacement(context: AppContext) {
  const { engine, scene, camera, canvas, ground, obstacles, controls, decorations } = context;
  context.placement = createPlacementAdapter({
    world: engine.world, input: engine.input,
    scene, camera, canvas, ground, groundSize: GROUND_SIZE, groundHeight: GROUND_HEIGHT,
    obstacles, syncObstacles: controls.syncObstacles, syncCharacter: controls.syncExternalPose,
    getBlockers: () => decorations,
    debugGrid: new URLSearchParams(window.location.search).get(STARTUP_OPTIONS.gridKey) === STARTUP_OPTIONS.gridEnabledValue,
    onActiveChange(active) {
      if (active) controls.cancelTarget();
    },
  });
}
