# EBR-72: engine decision

**Decision:** keep Three.js and build a thin game layer using Miniplex. Jiaxu confirmed this direction.
This is a proposal, not an implementation or a performance result.

The baseline description below is historical. For the character, placement and
environment ports, see [src/core/README.md](../src/core/README.md).

## Where we are

- [package.json](../package.json) uses Three.js, Vite and Playwright; [README.md](../README.md) describes the playable build.
- [src/main.ts](../src/main.ts) wires the scene and isometric camera, character controls, collisions and stairs,
  placement, day/night lights, weather, pixel presentation and the HTML HUD. Its Three.js animation loop updates them all.
  [src/scene/createScene.ts](../src/scene/createScene.ts) builds the scene and island;
  [src/scene/farmCollisions.ts](https://github.com/ljxw88/chicken-farm/blob/9e8c8c6/src/scene/farmCollisions.ts) and
  [src/scene/createStoneStairs.ts](../src/scene/createStoneStairs.ts) implement walking boundaries and stair support.
  [src/scene/createFarmLayout.ts](../src/scene/createFarmLayout.ts) hard-codes much of the layout and its obstacles.
- There is no central game state: the player position is a Three.js object; keys and click target live in
  [src/character/createCharacterControls.ts](https://github.com/ljxw88/chicken-farm/blob/9e8c8c6/src/character/createCharacterControls.ts); placement keeps arrays/maps
  and shares the obstacle array with walking in [src/placement/createPlacement.ts](../src/placement/createPlacement.ts).
  Day/night and weather keep their own state in [src/lighting/createDayNightCycle.ts](../src/lighting/createDayNightCycle.ts)
  and [src/weather/createWeatherSystem.ts](../src/weather/createWeatherSystem.ts). Placed objects reset on reload.
- Movement delta is clamped after a stall, while lighting and weather get elapsed time; no fixed simulation tick exists.
  The locked pixel default is in [src/postprocess/index.ts](../src/postprocess/index.ts); the HUD remains crisp HTML
  ([src/ui/createFarmHud.ts](../src/ui/createFarmHud.ts)). Existing weather, phase and pixel console setters are public.
- Some collision/grid logic is unit-testable, but replaying integrated state/time needs Three.js and DOM fixtures
  ([tests/placement.test.mjs](../tests/placement.test.mjs)). Browser tests inject access to `main.ts` locals
  ([tests/browser/visual.browser.mjs](../tests/browser/visual.browser.mjs)); no main-frame pixel-diff gate exists.

## Options and pick

- **A: thin own layer on Three.js.** Reuse the approved look and browser stack; we still own the loop, input, state,
  adapters and tests. ECS choices:
  - **Miniplex (pick):** typed plain-object entities and queries fit this code; it does not schedule systems. It adds a
    dependency and object overhead; we own scheduling and persistent IDs. Component membership must use its API to keep
    queries current
    ([Miniplex](https://github.com/hmans/miniplex#readme)).
  - **bitECS:** ID-indexed, data-oriented stores can use typed arrays or objects; explicit data/ID bookkeeping adds
    complexity, and its MPL-2.0 license needs review. No performance need has been measured here
    ([bitECS](https://github.com/NateTheGreatt/bitECS#readme)).
  - **Hand-rolled registry:** no dependency, but we maintain entity lifecycle, queries and their tests as features grow.
- **B: Phaser/Excalibur.** Primarily 2D; recreating the signed-off 3D look, lighting and movement costs art/port work
  and risks visual drift and reapproval.
- **C: Babylon/PlayCanvas.** 3D, but a heavy scene, materials, input, weather and postprocess port risks visual drift.
- **D: Godot web export.** Rewrite the game and pipeline; browser export, asset conversion and look parity add risk.

Choose **A with Miniplex**: incremental TypeScript systems and existing Three.js visuals are a better fit than a renderer
port or a bespoke ECS. Revisit data-oriented storage only if profiling shows a need; no speed or size claim is assumed.

## Target layout and responsibilities

These paths are proposed; they do not exist yet.

- `src/core/loop`: fixed-step accumulator (start with 1/60 s) and explicit system order; render separately once per
  animation frame. Bound movement catch-up to today's 0.1 s per frame; lighting/weather still get full elapsed time.
- `src/core/ecs`: Miniplex world, project-owned stable IDs and plain-data components; systems are ordinary functions.
  For example, cottage, stream and sheep are data records (`id`, transform, asset ID, components) processed by
  building, stream and animal systems respectively. These are future examples, not claims of existing gameplay.
- `src/core/input`: keyboard, click and touch become actions for move/move-to and placement select, rotate, confirm,
  remove, undo and cancel. Preserve focus/blur, keyboard cancellation, placement-first handling and touch preview/confirm.
- `src/content/`: data files for the tile grid, prop definitions/positions, weather and day-phase presets. Copy existing
  values without retuning. `assetId` resolves through slots/factories in `render/`, not Three.js objects in game data.
- `src/state/`: plain game state and a versioned, JSON-friendly **hook shape only**; no storage or auto-load yet:

  ```ts
  type SaveV1 = { version: 1; contentId: string; player: { position: [number, number, number]; yaw: number };
    placed: Array<{ id: string; kind: string; cell: [number, number]; rotation: number }>;
    clock: { progress: number; cycleSeconds: number; held: boolean };
    weather: { mode: 'clear' | 'cloudy' | 'rain'; rainProgress: number; cloudyProgress: number } };
  interface SaveHooks { save(): SaveV1; load(save: SaveV1): void }
  ```

  IDs are stable across saves; rotation is in quarter turns. This is a contract, not a persistence implementation.
- `src/render/`: adapt state to the existing Three.js scene/camera and asset slots. Call the existing pixel pass, lights
  and weather visuals unchanged; keep the HTML HUD separate and existing console controls working.
- `src/debug/`: opt-in dev/QA `window.__game` getters for player position, state and frame metrics. Return detached,
  deeply read-only snapshots, never live Three.js objects or mutation commands; existing console setters remain separate.
- `tools/selfplay/`: proposed `npm run selfplay` starts Vite and headless Chromium, drives a real click/WASD route from
  spawn down the stairs and back, and reports rendered FPS (rendered frames / elapsed seconds), console/page errors,
  checkpoint screenshots and player position. Fail on errors, missing artifacts or a missed route; close browser/server.
  Run `npx playwright install chromium` first; no FPS target is asserted. Export and LAN/phone play come later.

## Migration and parity gate

**Gate G applies to every slice:** record the main SHA at slice start and capture main and slice frames with the same Chromium/
SwiftShader, viewport, DPR, pixel mode, phase/weather, seed, controlled time, camera and input/pose. Diff spawn,
stairs, placement, day/night and weather frames; save baseline, candidate, diff image and changed-pixel count, with no
unexplained or unapproved differences. Supply a seeded weather RNG from initialization in the test harness:
[src/weather/createRainEffect.ts](../src/weather/createRainEffect.ts) uses randomness. Build this comparison in slice 1.
Also run `npm test` and `npm run test:browser`: [tests/browser/stairs.browser.mjs](../tests/browser/stairs.browser.mjs) must still
pass all three pad-side sequences: S+A → W+A; W+D → W+A; S+D → S+A → W+D → W+A, without clipping or leaving the
ground. [tests/browser/placement.browser.mjs](../tests/browser/placement.browser.mjs) must still pass. Retain the existing
test-only `main.ts` injection seam or migrate its instrumentation without weakening scenarios/assertions.

EBR-47 (cottage + coops) is already in flight on the old structure: land it first, or port it in slice 2. If it has not
landed, still diff every frame against main and identify its intentional additions; also diff cottage/coops frames against
the old-structure EBR-47 build. EBR-48 stream waits for slices 1–2.

1. **Engine core.** Scope: loop, Miniplex, action map and parity capture, bridged to current code. Acceptance: fixed
   ticks are independent of render rate, one-shot actions fire once, and legacy behavior remains. **Proof:** G, including walking.
2. **Character.** Scope: port character, collisions and stairs; include EBR-47 if needed. Acceptance: keyboard,
   click/touch, sliding, stair support and void boundaries match. **Proof:** G, including all pad-side sequences.
3. **Placement and environment.** Scope: port placement and adapt existing weather/day-night drivers. Acceptance: placement priority,
   undo, fence/plot collisions, URL-pinned phases, weather transitions and existing setters work. **Proof:** G, including
   placement previews/objects and day/night/weather frames.
4. **Content and state.** Scope: move grid, props and environment values into data; introduce the save hook shape.
   Acceptance: same scene from data and a type-checked JSON-friendly snapshot; no persistence. **Proof:** G.
5. **QA and self-play.** Scope: read-only `window.__game` and the harness. Acceptance: snapshots cannot mutate the
   game; one command produces the route, measured FPS, errors, screenshots and position. **Proof:** G with QA on/off.
6. **Share/export (later).** Scope: one self-contained HTML file and LAN serving. Acceptance: `file://` opens with inline
   JS/CSS/assets; the same file serves to a physical phone on the LAN with touch walking/placement. **Proof:** G plus export/main diffs.

## Risks and non-goals

Fixed ticks, input ownership and shared obstacle state can subtly change movement or placement; preserve the old timing
and collision semantics and use G before advancing. Keep Miniplex component changes indexed and dispose render assets
when entities leave. This spike does not switch engines, retune art/lights/weather, add cottage/stream/sheep gameplay,
implement saves, multiplayer or telemetry, or ship sharing before slice 6.
