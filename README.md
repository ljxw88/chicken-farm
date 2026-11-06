# Chicken Farm

A minimal 3D scene built with Vite, vanilla TypeScript, and Three.js. A small character walks around a grassy farm while an isometric camera follows and the lighting cycles from morning through night.

Meadow look reference: https://x.com/daniildesigns/status/2117571497665663044

## Run locally

Use Node.js 20.19+ (20.x) or 22.12+.

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). If that port is already in use, Vite will print another local URL.

For a console-free weather and lighting check, open a URL such as `http://localhost:5173/?weather=cloudy&phase=night`. Weather accepts `clear`, `cloudy` or `rain`; phase accepts `morning`, `daytime`, `sunset` or `night`. The requested weather fades in over 1.75 seconds. A valid URL phase stays fixed for repeatable review; without one, the normal day/night cycle runs. Invalid parameters are ignored independently. Calling either day/night console setter resumes the cycle after a URL-pinned phase.

Use **WASD** to walk relative to the screen, or click/tap the ground to walk there. From spawn, follow the curved dirt path left toward the barn, or follow it right past the pond and toward the ground edge. The barn, tree trunks, and pond water block movement; the character slides along them and stops when fully blocked. Click-to-move does not plan a route around obstacles. Keyboard input cancels a click-to-move destination, and the character stays within the grassy ground.

The full day/night cycle takes 72 seconds by default. To inspect a phase immediately, use the browser console:

```js
setDayNightPhase('morning') // also: 'daytime', 'sunset', 'night'
setDayNightCycleSeconds(12) // complete cycle in 12 seconds
```

The cycle keeps running after selecting a phase in the console. Walk toward a ground edge to see the changing sky; the ground fills the initial isometric view. Its `setDayNightCycleSeconds(seconds)` method is also available on the object returned by `createDayNightCycle` in `src/lighting/` for a future HUD. It accepts finite positive seconds and preserves the current phase when changed. The day/night phase presets are Look Dev LOCKED; intermediate phases are interpolated. Weather adjustments are separate from those presets.

Weather starts clear unless selected by URL. In the browser console, call `setWeather('cloudy')` for overcast, `setWeather('rain')` for gentle rain, or `setWeather('clear')` to return to clear weather. `getWeather()` reports the requested `mode` and current `rainAmount` and `cloudyAmount` (each 0–1). A full transition takes 1.75 seconds and follows the current day/night phase. Rain fades smoothly when switching to or from Cloudy. Rain settings in `src/weather/rainSettings.ts` use Look Dev's visually approved starting targets; apart from the shared transition, they are not explicitly LOCKED. Look Dev LOCKED the relative Cloudy settings in `src/weather/cloudySettings.ts`: they reduce directional light and cool the phase's ambient and hemisphere colors without adding locked hex colors. Sky, fog and the warm night practical lights are unchanged.

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

Only `#scene` is scaled. Future HTML UI should be a separate, positioned sibling above the canvas, not a child of a transformed/pixelated container. For weather and HUD integration notes, see `DELIVER-EBR37.txt`.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check pixel sizing, the farm, collisions, camera, weather and lighting.

The entry point is `src/main.ts`, the pixel presentation is in `src/postprocess/`, the farm layout and camera are in `src/scene/`, the character and controls are in `src/character/`, and the locked lighting presets and cycle driver are in `src/lighting/`. Look Dev LOCKED farm colors are collected in `src/scene/farmPalette.ts`.
