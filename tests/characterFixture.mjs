// Exercise the same entity system and action bindings as the application,
// while allowing unit tests to advance arbitrary deltas and arrange the scene.
export async function loadCharacterFixture(vite) {
  const { createCharacterController } = await vite.ssrLoadModule('/src/character/createCharacterController.ts');
  const { createEntityWorld } = await vite.ssrLoadModule('/src/core/ecs/createEntityWorld.ts');
  const { createInputActions } = await vite.ssrLoadModule('/src/core/input/actions.ts');
  const { bindInputActions } = await vite.ssrLoadModule('/src/core/input/bindInputActions.ts');
  return (options) => {
    const { onPointerDown, getPlacement, ...characterOptions } = options;
    const world = createEntityWorld();
    const input = createInputActions(getPlacement);
    const controls = createCharacterController({ ...characterOptions, world, input });
    const unbind = bindInputActions(input, window, options.canvas, { ownMovement: true, onPointerDown });
    return { ...controls, world, input, dispose() { unbind(); controls.dispose(); } };
  };
}
