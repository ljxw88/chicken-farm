import { CHARACTER_RADIUS, createCharacterController } from '../character';
import { GROUND_HEIGHT, GROUND_SIZE } from '../scene/createScene';
import type { AppContext } from './context';

export function registerCharacter(context: AppContext) {
  const { engine, character, camera, canvas, ground, obstacles, clickTargets, stairs, bridgeHeight } = context;
  context.controls = createCharacterController({
    world: engine.world, input: engine.input, character, camera, canvas, ground,
    groundSize: GROUND_SIZE, groundHeight: GROUND_HEIGHT, characterRadius: CHARACTER_RADIUS,
    obstacles, clickTargets, stairs, bridgeHeight, groundShadow: character.getObjectByName('character-shadow'),
  });
}
