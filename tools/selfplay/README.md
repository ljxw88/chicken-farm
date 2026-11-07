# QA inspection and self-play

Add `?qa=1` to opt in to `window.__game`. Without that exact value the property
is absent. It is a non-configurable getter with no setter; each read constructs
a new, recursively frozen, JSON-friendly snapshot, not a live scene object or a
control API. Existing console controls are separate and unchanged.

Snapshot version 1 contains the rendered player position and yaw; clock
progress, cycle length and held state; weather mode and rain/cloud/snow
progress and amounts; phase and night amount; camera position, quaternion,
zoom and orthographic frustum; HUD labels, sky panel and placement state; and
route status, target, remaining waypoints and current movement input. A route
is `following` for a click target, `manual` for held movement, or `idle`.
Previously returned snapshots never update when the world advances.

Install dependencies and Chromium, then run:

```sh
npm run play:harness
```

On the shared farm host, run that command through
`/home/michael/OpenBot/Shared/farm-tools/heavy`.

The command starts and closes a strict-port Vite server on `127.0.0.1:5252` and
headless Chromium/SwiftShader. It uses the getter and real pointer/keyboard
input to travel from spawn over the bridge to the bottom pad, climb the stairs,
and return to spawn. Each checkpoint records a position and route state; six
screenshots and a per-frame position trace accompany `report.json`. A missed
checkpoint, browser/page error, invalid measurement or missing screenshot
fails the command. Failure reports also retain the error. No application state is
teleported or changed through the getter. Positions are sampled at the
checkpoint before its screenshot; a moving route can advance during capture.

FPS is live `requestAnimationFrame` callbacks divided by real
`performance.now()` elapsed seconds. The engine renders once per animation
frame. Observer, screenshot and host-load overhead are included; this is not a
hardware-GPU benchmark and no FPS threshold is asserted. There is no simulated
time in this command. By default evidence goes under
`/home/michael/OpenBot/Shared/farm-evidence/EBR-77/<short-head>/selfplay/` in a
unique directory. Use `npm run play:harness -- --output /absolute/directory`
to choose another location outside the worktree. `--port 0` selects an ephemeral
port for isolated tests; the default stays 5252. Existing reports/screenshots
are not overwritten. The report records HEAD and any dirty worktree status.

## Hook parity (Gate G)

On a clean, final head, run the following through the shared heavy-job wrapper:

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy npm run gate:qa
```

The runner archives and verifies main `880aa12`, installs its dependencies,
builds it and the head, and captures their **production builds** at 1280×720,
DPR 1, seed 123, pinned clock/phase/weather and the same real W-key input. Both
use Chromium/SwiftShader. For day, sunset, night and fully transitioned rain it
captures four combinations per build: neither hook, the `?qa=1` getter alone,
the self-play timing scheduler alone, and both. Main predates the getter, so its
`?qa=1` captures also verify that the getter is absent there. Each capture uses
the same external Playwright virtual clock; timing-on additionally installs
the self-play rAF scheduler, while timing-off uses Playwright's unwrapped rAF.
The scheduler forwards browser timestamps and reads the snapshot every frame
when present. This tests the hook and scheduler independently and together; it
does not claim that the virtual clock itself is native real-time operation.
The route advances 800 ms with W held, then advances another 1000 ms before one
final frame. The report compares elapsed performance time and wall time; the
absolute `performance.now()` origins can differ between Chromium contexts.
Frame-rate measurement is deliberately left to live self-play.

All five within-build comparisons per scenario are exact RGBA, unmasked, and
must have zero changed pixels and identical public clock/weather state. The two
head captures with the getter also require identical complete snapshots. The
production screenshots are not instrumented. Separate read-only Vite source
probes use the existing test seam to compare main/head player pose, camera,
clock and weather before, during and after the route, and check the head probe
against its production getter. The report includes PNGs, diffs, counts, build
logs, browser details and the informational `880aa12`-versus-head comparison;
differences across those two
commits are attributed only if the separately built current `origin/main`
matches the head with zero changed pixels in every scenario. When current main
has advanced, it gets its own archived build, capture and pose probe. The
separate clean-main pre-gate is still required. The report and screenshots are
outside Git under
`Shared/farm-evidence/EBR-77/<short-head>/gate-g/`. `--only <scenario>` and
`--allow-dirty` are for development probes, not READY evidence. The normal
`node tools/pregate.mjs --pr-branch feat/ebr77-game-harness --ebr EBR-77`
remains a separate required gate.
