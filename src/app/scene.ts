import { createCharacter } from '../character';
import { createScene, GROUND_HEIGHT } from '../scene/createScene';
import { createGroundGrid } from '../world/ground';
import type { AppContext } from './context';

export function registerScene(context: AppContext) {
  Object.assign(context, createScene(context.canvas));
  context.groundGrid = createGroundGrid(undefined, context.stairs.bounds);
  const character = createCharacter();
  character.position.y = GROUND_HEIGHT;
  context.scene.add(character);
  context.follow(character.position);
  context.character = character;
}
