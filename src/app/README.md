# App feature registration

`main.ts` validates the canvas and both HUD roots, creates one `AppContext`, and registers these
modules in order before starting the engine:

1. `scene` creates the scene and player; `farm` selects the URL's crown season
   before creating the layout and fold. `garden` adds its dressing and targets,
   followed by farm decorations and shadows. The biome label uses the same season.
2. `engine` installs the existing input and ordered frame callbacks.
3. `environment`, `effects`, and `startup` create the clock, weather and visual
   effects, then apply URL options and publish the existing console setters.
4. `character`, `placement`, `audio`, and `hud` install their adapters in that order;
   audio creates a silent controller for the sky HUD, which uses its public-scene
   adapter and can be removed with `?skyhud=0`.
5. `presentation` creates the pixel composer, publishes its setters and handles
   the initial resize and later resize events.

The context is populated in that order; frame callbacks and input handlers run
only after registration is complete. Each frame still performs movement, clock
and shadow updates, HUD, camera follow, placement, weather state, night amount,
weather rendering, smoke, fireflies, sky state/HUD, waterfall and sheep updates
in that order before rendering. The
movement delta remains capped; the clock excludes paused time on resuming follow,
while weather and effects receive the full elapsed delta.
