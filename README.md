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

For a console-free weather and lighting check, open a URL such as `http://localhost:5173/?weather=cloudy&phase=night`. Weather accepts `clear`, `cloudy` or `rain`; phase accepts `morning`, `daytime`, `sunset` or `night`. The requested weather fades in over 1.75 seconds. A valid URL phase stays fixed for repeatable review; without one, the normal day/night cycle runs. Invalid parameters are ignored independently. Calling either day/night console setter resumes the cycle after a URL-pinned phase.

Use **WASD** to walk relative to the screen, or click/tap the grass to walk there. From spawn, follow the curved dirt path left toward the cottage and coops, or right past the pond to the stone stairs at the island rim. Click a tread or the small foot pad to walk down, or line up with the stairs and hold **S+D**; **W+A** climbs back up. The stair sides and pad edge stop at the void; there is no ground beyond the pad. The cottage, both coop bodies and ramps, tree trunks, pond water and the rest of the rim also block movement; the character can slide along them. Clicking the void does not start a walk. Click-to-move does not plan a route around obstacles, and keyboard input cancels a clicked destination.

The chicken, nest, sign and bin are static, nonblocking scenery. There are no feeding, collection, market or inventory actions in the playable build.

## Free placement

Use the direct **FREE Fence** or **Plot** buttons (or **F** / **P**) to enter placement mode. Move the pointer over the island to preview; **R** rotates the ghost and clicking the ground places it. **Enter** or the **Place** button also confirms the current preview; **Escape** or **Cancel** exits without placing it. On touch, tap a tile to preview, then use **Rotate** and **Place**. You can keep walking with WASD while previewing.

The grid uses 1.5-world-unit tiles to fit the fence's 1.47-unit footprint. A plot occupies two tiles and remains walkable; a fence occupies one tile and blocks walking until removed. Full tiles are centred on the island top, leaving a half-unit unbuildable strip at each edge; stairs and the foot pad are not placement surfaces. Existing obstacles, visible scenery, the player and occupied tiles are invalid. Hover a placed object's tile and press **Delete**, or choose **Remove** and click/tap the object; choose **Remove** again to return to placing. **Z** / **Undo** removes the most recently placed remaining object. Placement is free and its objects reset on reload.

The debug grid is hidden by default. Open `?grid=1` (or add `&grid=1` to other URL options) to show its dirt-coloured hairlines. The world, including previews and the grid, goes through the default pixel pass.

The island, soil/rock rim and void are visible on load. The full day/night cycle takes 72 seconds by default. To hold a phase without a console, open one of:

```text
http://localhost:5173/?phase=morning
http://localhost:5173/?phase=daytime
http://localhost:5173/?phase=sunset
http://localhost:5173/?phase=night
```

A valid phase URL holds that phase until you navigate away or use a day/night console setter; a missing or invalid phase keeps the normal cycle running. You can also use the browser console:

```js
setDayNightPhase('morning') // also: 'daytime', 'sunset', 'night'
setDayNightCycleSeconds(12) // complete cycle in 12 seconds
```

The cycle keeps running after selecting a phase in the console. The top-left phase label follows the current lighting segment; Day 1 and Spring are placeholders. The island is surrounded by a fixed #101416 void; the phase fog and lighting still change over time. The cycle's `setDayNightCycleSeconds(seconds)` method accepts finite positive seconds and preserves the current phase when changed. Signed colors and the sun/moon key are unchanged; ambient and hemisphere intensities were reduced to restore directional shading. Intermediate phases are interpolated. Weather adjustments are separate from those presets; see `docs/lighting-audit.md` for the visual change and evidence.

Weather starts clear unless selected by URL. In the browser console, call `setWeather('cloudy')` for overcast, `setWeather('rain')` for gentle rain, or `setWeather('clear')` to return to clear weather. `getWeather()` reports the requested `mode` and current `rainAmount` and `cloudyAmount` (each 0–1). A full transition takes 1.75 seconds and follows the current day/night phase. Rain fades smoothly when switching to or from Cloudy. Rain settings in `src/weather/rainSettings.ts` use Look Dev's visually approved starting targets; apart from the shared transition, they are not explicitly LOCKED. Look Dev LOCKED the relative Cloudy settings in `src/weather/cloudySettings.ts`: they reduce directional light and cool the phase's ambient and hemisphere colors without adding locked hex colors. The void, fog, windows and lantern glass are unchanged; the carried point light is now a smaller local fill at night.

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

Only `#scene` is scaled. The HTML HUD is a separate, positioned sibling above the canvas, not a child of a transformed/pixelated container. For weather and HUD integration notes, see `DELIVER-EBR37.txt`.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check the phase HUD, generic interaction utilities, pixel sizing, farm, collisions, camera, weather and lighting. For the Chromium playable-build checks, install the browser once with `npx playwright install chromium`, then run `npm run test:browser` (which also builds).

The directional-light regression check is `node --test tests/browser/lighting.browser.mjs`. `npm run parity` uses the EBR-73 Gate G baseline; `npm run lighting:parity` includes additional sunset and cloudy frames. The lighting changes intentionally make lit frames differ. Do not re-baseline until Look Dev signs; see `docs/lighting-audit.md` before interpreting a nonzero result.

The entry point is `src/main.ts`, free placement is in `src/placement/`, the pixel presentation is in `src/postprocess/`, the farm layout, static decorations and camera are in `src/scene/`, the character and controls are in `src/character/`, and the lighting presets and cycle driver are in `src/lighting/`. Cottage and coop positions and dimensions are shared in `src/scene/farmBuildingSpecs.ts`; their windows and pop-holes follow the night lighting. Look Dev LOCKED farm colors are collected in `src/scene/farmPalette.ts`. The new fixed-step loop, Miniplex world and input actions are described in `src/core/README.md`; existing gameplay still uses its current paths. The reusable `Interactable` contract and controller remain in `src/interactions/`, but are not wired into the playable build.
