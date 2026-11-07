# Engine core and migration bridge

`createEngine` owns a Miniplex-backed world, an action mapper and an ordered
array of ordinary system functions. It accumulates 1/60-second simulation
steps, accepting at most 0.1 seconds per rendered frame. Excess stall time is
dropped from simulation, not replayed later. Each system receives the same
input snapshot once per tick; held movement persists and one-shot actions are
removed after the first tick that sees them. A frame with no tick keeps the
one-shots for the next tick. Rendering runs once per animation frame.

Character movement, the day/night clock and weather envelopes run as ordered
**frame systems** after the fixed ticks. Movement receives `min(delta, 0.1)`;
the clock and weather receive the full elapsed delta, exactly as before. The
existing lighting, rain, HUD and pixel adapters render the resulting state.
Moving these systems to fixed ticks would change timing and needs a separate gate.

Supply fixed and frame systems in their desired order to `createEngine`:

```ts
const systems: EngineSystem[] = [updateFixedGameplay];
const frameSystems: EngineFrameSystem[] = [updateCharacter];
```

Use `world.create(components)` for a new immutable project ID and
`world.create(components, savedId)` to restore one into a fresh world. IDs are
never reused within a world. Components are plain finite JSON data; renderer
objects belong in adapters, not entities. Query with `world.with(...)` and
`world.without(...)`. Add/remove component **membership** via
`world.addComponent`/`world.removeComponent` so Miniplex updates its live
queries; component values may be mutated normally. Extending the component
schema uses `createEngine<MyComponents>` or `createEntityWorld<MyComponents>`.

The player transform, movement target, stair surface, placement tool, placed
items, collision footprints, clock and weather are plain Miniplex components.
Three.js adapters resolve pointer rays and decorative bounds at event time,
apply entity poses and retain the bridge height hook. Placed fences own their
walking obstacle components; plots reserve tiles without blocking walking. The
shared scene obstacle array remains a derived compatibility view for placed
fences. The stair renderer and shadows delegate to the same surface calculations.

The default farm records and appearance slots live in `src/content/`; asset IDs
resolve to Three.js factories in `src/render/`. `src/state/snapshot.ts` describes
the live ECS as detached, versioned JSON data. Its save/load interface is a
contract only: no persistence or loading is installed.

Pointer coordinates are CSS viewport coordinates. Placement handles a pointer
first; touch/pen taps preview, mouse clicks can confirm, and the direct Place
control confirms touch previews. Keyboard movement and entering placement
cancel a move-to; key-up and window blur release held movement even if focus
changed. Placement actions run immediately, preserving input priority and the
existing event-time preview/confirm behavior. Fixed-tick action queues retain
their one-shot contract independently of the immediate action subscriptions.
