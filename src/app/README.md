# App feature registration

`main.ts` validates the two roots, creates one `AppContext`, and registers these
modules in order before starting the engine:

1. `scene` creates the scene and player; `farm` creates the layout, fold,
   decorations and shadows.
2. `engine` installs the existing input and ordered frame callbacks.
3. `environment`, `effects`, and `startup` create the clock, weather and visual
   effects, then apply URL options and publish the existing console setters.
4. `character`, `placement`, and `hud` install their adapters in that order.
5. `presentation` creates the pixel composer, publishes its setters and handles
   the initial resize and later resize events.

The context is populated in that order; frame callbacks and input handlers run
only after registration is complete. Each frame still performs movement, clock
and shadow updates, HUD, camera follow, placement, weather, smoke, fireflies,
waterfall and sheep updates in that order before rendering. The movement delta
remains capped while environment and effects receive the full elapsed delta.
