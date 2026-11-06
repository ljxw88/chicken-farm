import { createEntityWorld, type CoreComponents, type EntityWorld } from '../ecs';
import { bindInputActions, createInputActions, type InputFrame, type PlacementInputContext } from '../input';
import { createFixedStepAccumulator } from './fixedStep';

export type EngineSystem<Components extends object = CoreComponents> =
  (world: EntityWorld<Components>, input: InputFrame, stepSeconds: number) => void;

interface EngineOptions<Components extends object> {
  setAnimationLoop: (callback: ((time: number) => void) | null) => void;
  beforeFrame?: () => void;
  // Until the gameplay ports, this runs the existing variable-step paths once
  // per render frame with their original full elapsed delta.
  update: (deltaSeconds: number) => void;
  render: (deltaSeconds: number) => void;
  systems?: readonly EngineSystem<Components>[];
  input?: { target: Window; canvas: HTMLCanvasElement; getPlacement: () => PlacementInputContext };
}

export function createEngine<Components extends object = CoreComponents>(options: EngineOptions<Components>) {
  const world = createEntityWorld<Components>();
  const input = createInputActions(options.input?.getPlacement);
  const systems = [...(options.systems ?? [])];
  const fixed = createFixedStepAccumulator({
    systems: [(stepSeconds) => {
      // Every system sees the same input for this tick. Subsequent catch-up
      // ticks get the held movement but not the already-consumed one-shots.
      const frame = input.consume();
      for (const system of systems) system(world, frame, stepSeconds);
    }],
  });
  let previousTime: number | undefined;
  let unbind: (() => void) | undefined;
  let running = false;

  function frame(time: number) {
    options.beforeFrame?.();
    const deltaSeconds = previousTime === undefined ? 0 : Math.max((time - previousTime) / 1000, 0);
    previousTime = time;
    fixed.advance(deltaSeconds);
    options.update(deltaSeconds);
    options.render(deltaSeconds);
  }

  function start() {
    if (running) return;
    running = true;
    previousTime = undefined;
    fixed.reset();
    if (options.input) unbind = bindInputActions(input, options.input.target, options.input.canvas);
    options.setAnimationLoop(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    options.setAnimationLoop(null);
    unbind?.();
    unbind = undefined;
    input.reset();
    previousTime = undefined;
    fixed.reset();
  }

  return { start, stop, world, input };
}
