# Engine core and migration bridge

`createEngine` owns a Miniplex-backed world, an action mapper and an ordered
array of ordinary system functions. It accumulates 1/60-second simulation
steps, accepting at most 0.1 seconds per rendered frame. Excess stall time is
dropped from simulation, not replayed later. Each system receives the same
input snapshot once per tick; held movement persists and one-shot actions are
removed after the first tick that sees them. A frame with no tick keeps the
one-shots for the next tick. Rendering runs once per animation frame.

Slice 1 intentionally registers **no gameplay systems**. The existing variable-
delta character, collisions, stairs, placement, lights, weather, HUD and pixel
rendering still run in their original order after the new ticks. Walking still
receives `min(delta, 0.1)`; lighting and weather receive the full elapsed
delta. The action listeners observe input without preventing or replacing any
existing handler. This is a bridge, not a second implementation of gameplay.

For later slices, supply systems in the desired order to `createEngine`:

```ts
const systems: EngineSystem[] = [readActions, updateCharacter, updatePlacement];
```

Use `world.create(components)` for a new immutable project ID and
`world.create(components, savedId)` to restore one into a fresh world. IDs are
never reused within a world. Components are plain finite JSON data; renderer
objects belong in adapters, not entities. Query with `world.with(...)` and
`world.without(...)`. Add/remove component **membership** via
`world.addComponent`/`world.removeComponent` so Miniplex updates its live
queries; component values may be mutated normally. Extending the component
schema uses `createEngine<MyComponents>` or `createEntityWorld<MyComponents>`.

Pointer action coordinates are CSS viewport coordinates; an eventual render/
raycast adapter resolves them to world destinations. Placement has priority
over move-to. Touch/pen taps preview, while mouse clicks can confirm and the
direct Place control confirms touch previews. Keyboard movement and entering
placement cancel a move-to; key-up and window blur release held movement even
if focus changed.
