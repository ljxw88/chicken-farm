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

Use **WASD** to walk relative to the screen, or click/tap the ground to walk there. Follow the tan path from the spawn: the left fork leads to the barn door, and the other fork curves toward the pond. The barn, tree trunks, and pond water block movement; the character slides along them and stops when fully blocked. Click-to-move does not plan a route around obstacles. Keyboard input cancels a click-to-move destination, and the character stays within the grassy ground.

The full day/night cycle takes 72 seconds by default. To inspect a phase immediately, use the browser console:

```js
setDayNightPhase('morning') // also: 'daytime', 'sunset', 'night'
setDayNightCycleSeconds(12) // complete cycle in 12 seconds
```

The cycle keeps running after selecting a phase. Walk toward a ground edge to see the changing sky; the ground fills the initial isometric view. Its `setDayNightCycleSeconds(seconds)` method is also available on the object returned by `createDayNightCycle` in `src/lighting/` for a future HUD. It accepts finite positive seconds and preserves the current phase when changed. All lighting presets are Look Dev LOCKED; only the transitions are interpolated.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check the farm, collisions, camera and lighting.

The entry point is `src/main.ts`, the farm layout and camera are in `src/scene/`, the character and controls are in `src/character/`, and the locked lighting presets and cycle driver are in `src/lighting/`. Farm colors are provisional and collected in `src/scene/farmPalette.ts`.
