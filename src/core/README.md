# Engine core and migration bridge

`createEngine` owns a Miniplex-backed world, an action mapper and an ordered
array of ordinary system functions. It accumulates 1/60-second simulation
steps, accepting at most 0.1 seconds per rendered frame. Excess stall time is
dropped from simulation, not replayed later. Each system receives the same
input snapshot once per tick; held movement persists and one-shot actions are
removed after the first tick that sees them. A frame with no tick keeps the
one-shots for the next tick. Rendering runs once per animation frame.

Character movement now runs as an ordered **frame system** after the fixed ticks
and before the still-unported placement, lights, weather, HUD and pixel render
paths. It receives `min(delta, 0.1)`, exactly as before; lighting and weather
still receive the full elapsed delta. Moving character simulation to fixed
ticks would change its timing and must be gated separately.

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

The player transform, movement target, stair surface and individual collision
footprints are plain Miniplex components. The Three.js adapter resolves pointer
actions at event time, applies the entity pose and keeps the existing bridge
height hook. It synchronizes the shared placement obstacle array into live
obstacle entities before movement, so placement and walking never diverge.
The stair renderer and shadows delegate to the same surface calculations.

Pointer coordinates are CSS viewport coordinates. Placement handles a pointer
first; touch/pen taps preview, mouse clicks can confirm, and the direct Place
control confirms touch previews. Keyboard movement and entering placement
cancel a move-to; key-up and window blur release held movement even if focus
changed. Fixed-tick action queues retain their one-shot contract independently
of the immediate movement action subscription.
