# Chicken Farm

A minimal 3D scene built with Vite, vanilla TypeScript, and Three.js. A small character walks around a raised farm island while an isometric camera follows and the lighting cycles from morning through night.

Meadow look reference: https://x.com/daniildesigns/status/2117571497665663044

## Run locally

Use Node.js 20.19+ (20.x) or 22.12+.

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). If that port is already in use, Vite will print another local URL.

For a console-free weather and lighting check, open a URL such as `http://localhost:5173/?weather=cloudy&phase=night`. Weather accepts `clear`, `cloudy`, `rain` or `snow`; phase accepts `morning`, `daytime`, `sunset` or `night`. The requested weather fades in over 1.75 seconds. A valid URL phase stays fixed for repeatable review; without one, the normal day/night cycle runs. Invalid parameters are ignored independently. Calling either day/night console setter resumes the cycle after a URL-pinned phase.

Use **WASD** to walk relative to the screen, or click/tap the grass to walk there. From spawn, follow the curved dirt path left toward the cottage and coops, or right past the pond to the stone stairs at the island rim. Click a tread or the small foot pad to walk down, or line up with the stairs and hold **S+D**; **W+A** climbs back up. The stair sides and pad edge stop at the void; there is no ground beyond the pad. The cottage, both coop bodies and ramps, tree trunks, pond water and the rest of the rim also block movement; the character can slide along them. Click-to-move routes around obstacles, or approaches the nearest reachable point for a blocked or off-island destination. Keyboard input cancels a clicked destination.

The chicken, nest, sign and bin are static, nonblocking scenery. There are no feeding, collection, market or inventory actions in the playable build.

## Free placement

Use the direct **FREE Fence** or **Plot** buttons (or **F** / **P**) to enter placement mode. Move the pointer over the island to preview; **R** rotates the ghost and clicking the ground places it. **Enter** or the **Place** button also confirms the current preview; **Escape** or **Cancel** exits without placing it. On touch, tap a tile to preview, then use **Rotate** and **Place**. You can keep walking with WASD while previewing.

The grid uses 1.5-world-unit tiles to fit the fence's 1.47-unit footprint. A plot occupies two tiles and remains walkable; a fence occupies one tile and blocks walking until removed. Full tiles are centred on the island top, leaving a half-unit unbuildable strip at each edge; stairs and the foot pad are not placement surfaces. Existing obstacles, visible scenery, the player and occupied tiles are invalid. Hover a placed object's tile and press **Delete**, or choose **Remove** and click/tap the object; choose **Remove** again to return to placing. **Z** / **Undo** removes the most recently placed remaining object. Placement is free and its objects reset on reload.

The debug grid is hidden by default. Open `?grid=1` (or add `&grid=1` to other URL options) to show its dirt-coloured hairlines. The world, including previews and the grid, goes through the default pixel pass.

The island, soil/rock rim and void are visible on load. The full farm day takes 24 minutes by default. Open **A changing sky** with the toolbar's sun/moon button. The time chevrons choose a phase and pause it; **Follow the day** resumes the actual cycle. Weather chevrons choose **Clear skies**, **Cloudy**, **Gentle rain**, or **Soft snow**. **Let it change** cycles the real weather every quarter farm day, with at least 90 seconds between changes; choosing a weather manually turns automation off. Close the panel with **X** or the phase button. The speaker toggles on and muted after a user gesture, but both are silent placeholders; see `docs/audio.md`. More options are unavailable; fullscreen is enabled only when the browser supports it. Focused HUD controls keep their keyboard input; click the canvas to use walking or placement shortcuts again. `?skyhud=0` hides the sky panel and toolbar for clean visual comparisons.

To hold a phase without the panel or a console, open one of:

```text
http://localhost:5173/?phase=morning
http://localhost:5173/?phase=daytime
http://localhost:5173/?phase=sunset
http://localhost:5173/?phase=night
```

A valid phase URL holds that phase until you navigate away, turn on **Follow the day**, or use a day/night console setter; a missing or invalid phase keeps the normal cycle running. You can also use the browser console:

```js
setDayNightPhase('morning') // also: 'daytime', 'sunset', 'night'
setDayNightCycleSeconds(12) // complete cycle in 12 seconds
setDayNightFollowing(false) // pause, or true to resume
getDayNightState()          // current phase, following and cycleSeconds
```

The cycle keeps running after selecting a phase in the console. The top-left phase label follows the current lighting segment; Day 1 is a placeholder. Spring is the default: add `?season=autumn` (or `&season=autumn` to other options) for autumn tree crowns and the matching label. Other scenery remains unchanged; the season is selected on load. The island is surrounded by a fixed #101416 void; the phase fog and lighting still change over time. The cycle's `setDayNightCycleSeconds(seconds)` method accepts finite positive seconds and preserves the current phase when changed. The sun and moon share a fixed upper-left azimuth; their height, color and intensity change by phase. Intermediate phases are interpolated. Weather adjustments are separate from those presets; see `docs/lighting-audit.md` for the visual change and evidence.

Weather starts clear unless selected by URL. In the browser console, call `setWeather('cloudy')` for overcast, `setWeather('rain')` for gentle rain, `setWeather('snow')` for soft snow, or `setWeather('clear')` to return to clear weather. `getWeather()` reports the requested `mode` and current `rainAmount` and `cloudyAmount` (each 0–1). A full transition takes 1.75 seconds and follows the current day/night phase. Weather fades smoothly when switching modes. Rain settings in `src/content/rainSettings.ts` use Look Dev's visually approved starting targets; apart from the shared transition, they are not explicitly LOCKED. Look Dev LOCKED the relative Cloudy settings in `src/content/cloudySettings.ts`: they reduce directional light and cool the phase's ambient and hemisphere colors without adding locked hex colors. Snow settings are in `src/content/snowSettings.ts`. The void, fog, windows and lantern glass are unchanged; the carried point light is now a smaller local fill at night.

## Pixel rendering inspection

Look Dev locked the default to **4 CSS pixels**, with nearest-neighbor world rendering on by default. A 1280×720 view renders at approximately 320×180; height remains responsive rather than being fixed to 240. HTML stays crisp. Posterization and outlines are reserved for EBR-53.

For a console-free comparison, open `?pixel=0` for the original native-resolution view or `?pixel=1` to restore the pixel view. The default without a parameter is on. Optional browser-console inspection:

```js
getPixelRendering()       // canvas size, device DPR, integer block size and edge crop
setPixelRendering(false)  // compare with the original native-resolution render
setPixelRendering(true)   // restore the pixel pass
setPixelSize(3)           // temporary comparison in CSS pixels; finite values from 1 to 16
setPixelSize(4)           // restore the locked default
```

The device-pixel block size is rounded to an integer. Odd dimensions use centered partial blocks at the edges, rather than stretching the grid; fractional DPR may make the effective CSS size slightly different from the requested value. The camera projection and existing antialiasing remain unchanged, and the camera is not snapped to the pixel grid. `getPixelRendering().viewport` describes the planned pixel grid even in native comparison mode; `canvasWidth` and `canvasHeight` are the actual drawing buffer size.

Only `#scene` is scaled. The HTML HUD is a separate, positioned sibling above the canvas, not a child of a transformed/pixelated container. For weather and HUD integration notes, see `/home/michael/OpenBot/Shared/farm-evidence/_main-archive-843c242/DELIVER-EBR37.txt`.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check the phase HUD, generic interaction utilities, pixel sizing, farm, collisions, camera, weather and lighting. For the Chromium playable-build checks, install the browser once with `npx playwright install chromium`, then run `npm run test:browser` (which also builds).

For the clean-main PR pre-gate, see `docs/pregate.md`.

The directional-light regression check is `node --test tests/browser/lighting.browser.mjs`. `npm run parity` uses the EBR-73 Gate G baseline; `npm run lighting:parity` includes additional sunset and cloudy frames. Historical lighting changes intentionally differ from that older reference. EBR-76 scene data can be compared against clean `a75e8db`; the older `8dd79b8` replay does not exercise snow. See `tools/PARITY.md`. Do not re-baseline historical captures until Look Dev signs; see `docs/lighting-audit.md` before interpreting a nonzero historical result.

The entry point is `src/main.ts`, which registers the ordered feature modules in `src/app/`. Free placement is in `src/placement/`, pixel presentation in `src/postprocess/`, scene construction and the camera in `src/scene/`, and the character and controls are in `src/character/`. The sky HUD and its public-scene adapter are in `src/ui/`. Plain layout, dimensions, weather and lighting presets live in `src/content/`; Three.js asset factories are in `src/render/`. Cottage and coop data is in `src/content/buildings.ts`, and Look Dev farm colors are in `src/content/slots.ts`. Their windows and pop-holes follow the night lighting. The fixed-step loop, Miniplex world and input actions are described in `src/core/README.md`. `src/state/` describes JSON-friendly snapshots and a save/load hook shape; no persistence or auto-load is installed. The reusable `Interactable` contract and controller remain in `src/interactions/`, but are not wired into the playable build.
