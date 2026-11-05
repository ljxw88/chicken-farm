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

Use **WASD** to walk relative to the screen, or click/tap the grass to walk there. From spawn, follow the curved dirt path left toward the barn, or right past the pond to the island rim. The barn, tree trunks, pond water and the rim block movement; the character can slide along them. Clicking the void does not start a walk. Click-to-move does not plan a route around obstacles, and keyboard input cancels a clicked destination.

The island, soil/rock rim and void are visible on load. The full day/night cycle takes 72 seconds by default. To hold a phase without a console, open one of:

```text
http://localhost:5173/?phase=morning
http://localhost:5173/?phase=daytime
http://localhost:5173/?phase=sunset
http://localhost:5173/?phase=night
```

A valid phase URL holds that phase until you navigate away; a missing or invalid phase keeps the normal cycle running. You can also use the browser console:

```js
setDayNightPhase('morning') // also: 'daytime', 'sunset', 'night'
setDayNightCycleSeconds(12) // complete cycle in 12 seconds
```

Without a valid phase URL, the cycle keeps running after selecting a phase in the console. The island is surrounded by a fixed #101416 void; the existing phase fog and lighting still change over time. The `setDayNightCycleSeconds(seconds)` method is also available on the object returned by `createDayNightCycle` in `src/lighting/` for a future HUD. It accepts finite positive seconds and preserves the current phase when changed. The existing lighting presets remain Look Dev LOCKED; only the transitions are interpolated.

Weather starts clear. In the browser console, call `setWeather('rain')` for gentle rain or `setWeather('clear')` to return to clear weather; `getWeather()` reports the requested mode and current `rainAmount` (0–1). A full transition takes about 1.75 seconds and follows the current day/night phase. Rain settings in `src/weather/rainSettings.ts` use Look Dev's visually approved starting targets; they are not explicitly LOCKED.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check the farm, collisions, camera, weather and lighting.

The entry point is `src/main.ts`, the farm layout and camera are in `src/scene/`, the character and controls are in `src/character/`, and the locked lighting presets and cycle driver are in `src/lighting/`. Look Dev LOCKED farm colors are collected in `src/scene/farmPalette.ts`.
