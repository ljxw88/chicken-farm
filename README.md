# Chicken Farm

A minimal 3D scene built with Vite, vanilla TypeScript, and Three.js. It shows a sunlit green ground plane from an angled camera, with a subtle grid against a blue sky.

Meadow look reference: https://x.com/daniildesigns/status/2117571497665663044

## Run locally

Use Node.js 20.19+ (20.x) or 22.12+.

```sh
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). If that port is already in use, Vite will print another local URL.

## Production build

```sh
npm run build
```

The build is written to `dist/`. Run `npm run preview` to preview it locally.

The entry point is `src/main.ts`, and the scene is defined in `src/scene/createScene.ts`.
