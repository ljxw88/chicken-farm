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

Use **WASD** to walk relative to the screen, or click/tap the ground to walk there. From spawn, follow the curved dirt path left toward the barn, or follow it right past the pond and toward the ground edge. The barn, tree trunks, and pond water block movement; the character slides along them and stops when fully blocked. Click-to-move does not plan a route around obstacles. Keyboard input cancels a click-to-move destination, and the character stays within the grassy ground.

When near an object, press **E**, click/tap its prompt, or click/tap the object itself to use its primary action. The prompt selects the nearest available object; clicking an object selects that specific object. Walking into range does not interact, and clicking an out-of-range object only sets a normal ground destination. Release E before pressing it again.

For interaction QA, a static **chicken and egg are stubs** below spawn. Walk toward the chicken (screen-down / S), then feed it; move right toward the egg (S+D from there) and collect it. The stub starts with one free feed, tracks one collected egg in memory, and resets on reload. Feeding does not buy feed and collecting does not sell an egg. The nearby feed bin and sign are also stubs: the lid opens/closes, and the sign shows the supplied egg sale +3 / feed purchase -1 coin rates without making transactions. Flock AI, persistent inventory, storage, dialogue and trading are not implemented here.

The full day/night cycle takes 72 seconds by default. To inspect a phase immediately, use the browser console:

```js
setDayNightPhase('morning') // also: 'daytime', 'sunset', 'night'
setDayNightCycleSeconds(12) // complete cycle in 12 seconds
```

The cycle keeps running after selecting a phase. Walk toward a ground edge to see the changing sky; the ground fills the initial isometric view. Its `setDayNightCycleSeconds(seconds)` method is also available on the object returned by `createDayNightCycle` in `src/lighting/` for a future HUD. It accepts finite positive seconds and preserves the current phase when changed. All lighting presets are Look Dev LOCKED; only the transitions are interpolated.

Weather starts clear. In the browser console, call `setWeather('rain')` for gentle rain or `setWeather('clear')` to return to clear weather; `getWeather()` reports the requested mode and current `rainAmount` (0–1). A full transition takes about 1.75 seconds and follows the current day/night phase. Rain settings in `src/weather/rainSettings.ts` use Look Dev's visually approved starting targets; they are not explicitly LOCKED.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check interaction, farm, collisions, camera, weather and lighting. For the Chromium interaction checks, install the browser once with `npx playwright install chromium`, then run `npm run test:browser` (which also builds).

The entry point is `src/main.ts`, the farm layout and camera are in `src/scene/`, the character and controls are in `src/character/`, and the locked lighting presets and cycle driver are in `src/lighting/`. Look Dev LOCKED farm colors are collected in `src/scene/farmPalette.ts`. The reusable `Interactable` contract and controller are in `src/interactions/`; replaceable QA props are isolated in `src/interactions/qa/`.
