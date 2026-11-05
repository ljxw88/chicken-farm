# Chicken Farm

A minimal 3D scene built with Vite, vanilla TypeScript, and Three.js. A small character walks on a sunlit, grassy plane while an isometric camera follows.

Meadow look reference: https://x.com/daniildesigns/status/2117571497665663044

## Run locally

Use Node.js 20.19+ (20.x) or 22.12+.

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). If that port is already in use, Vite will print another local URL.

Use **WASD** to walk relative to the screen, or click/tap the ground to walk there. The character stays within the grassy ground; keyboard input cancels a click-to-move destination.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally, or `npm test` to check the camera and walking controls.

The entry point is `src/main.ts`, the scene and camera are in `src/scene/`, and the character and controls are in `src/character/`.
