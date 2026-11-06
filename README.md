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

The **A changing sky** panel starts open above the bottom toolbar. Use the time-of-day chevrons to choose Morning, Daytime, Sunset or Night; choosing a phase pauses the real lighting cycle. Turn **Follow the day** back on to resume from the current lighting. With following enabled, a farm day takes 24 minutes. The panel and the toolbar's sun/moon follow the closest lighting preset as the actual scene transitions smoothly.

Close the panel with **X** and reopen it with the sun/moon button. The expand button enters or exits browser fullscreen where supported. Weather is explicitly pending EBR-35: its selectors and **Let it change** are disabled. Sound and the extra-options button are also unavailable, rather than simulated. The HUD is HTML separate from the scene canvas; its fitting colors, fonts, blur and dimensions are provisional.

To inspect the actual lighting faster, use the browser console:

```js
setDayNightPhase('morning') // also: 'daytime', 'sunset', 'night'
setDayNightCycleSeconds(12) // complete cycle in 12 seconds while following
```

Console phase changes preserve the current follow/pause setting; the speed override preserves progress and updates the footer. Reload to restore the app's 24-minute day. The underlying `createDayNightCycle` still defaults to 72 seconds when used independently. Walk toward a ground edge to see the changing sky; the ground fills the initial isometric view. All lighting presets are Look Dev LOCKED; only the transitions are interpolated.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check the farm, collisions, camera, lighting and HUD state. For the desktop and emulated-mobile browser checks, install Chromium once with `npx playwright install chromium`, then run `npm run test:browser` (which builds first). Set `EBR36_EVIDENCE_DIR` to save screenshots and a proof JSON.

The entry point is `src/main.ts`, the farm layout and camera are in `src/scene/`, the character and controls are in `src/character/`, and the locked lighting presets and cycle driver are in `src/lighting/`. The DOM HUD, reusable controls and adapter contracts are in `src/ui/`; `weatherAdapter.ts` is the pending EBR-35 boundary. Look Dev LOCKED farm colors are collected in `src/scene/farmPalette.ts`.
