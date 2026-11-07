# EBR-70 evidence

For the EBR-75 merge and comparisons against clean `6daf042` and the exact
pre-merge head, see [`merge-6daf042/`](merge-6daf042/README.md).

**Historical:** the root-level frames and logs document the original
`8ce0cbe` submission. For the Look Dev sheep revision, use
[`sheep-revision/`](sheep-revision/README.md) and the new masks under
`mask/sheep-revision/` and `mask/main-revision/`.

`candidate/` and `baseline/` contain matched 1280×720, DPR-1 Chromium/SwiftShader
frames. `diff/` is magenta where the complete frames differ. In `mask/`, white
pixels are the declared allowed changes: the candidate with the new sheepfold
and its shadows rendered versus the **same candidate frame** with that group
hidden; black pixels must not change. For `placement-rejected`, the mask also
includes the required changed ghost/wash and status, isolated by temporarily
removing only the new obstacles in a test-only frame; its feedback-only mask is
`mask/placement-rejected-feedback.png`. `gate-g.json` records each mask's
bounds, changed-pixel counts, pixels outside it, hidden-candidate versus main
counts, and overlap with HUD bounds. A zero hidden-candidate count proves that
no unrelated pixels were silently allowed by the mask. The mask is per frame,
not a blanket rectangle; it also includes the unchanged frosted HUD's normal
compositing when a new object passes behind it.

The three `pen-*` frames use the usual isometric angle and a test-only camera
focus/zoom to show the animals. `crops/` enlarges unmodified portions of those
frames by 3× (pen) and 4× (each sheep), nearest-neighbour; crop coordinates are in
`gate-g.json`. The normal spawn, movement, stairs, valid placement, buildings,
clear/cloudy/rain, sunset and night views remain in the comparison as well.

`browser/route.json` records real WASD around the west rim, behind and around
the east side, through the opening, against a sheep and the shelter, and back
out to a front fence. The matching screenshots are in `browser/`.
`browser/wool-cycle.json` measures the visible wool by rendering with and
without the six wool lobes at the same pose; it reports all-channel clipping
and repeated still-frame differences. `stairs/` records the three existing
pad-side routes when the browser suite is run with the commands below.
`geometry.json` records rendered and collision bounds and clearances.
`lighting-original-probe-failure.log` preserves the initial lighting-check
failure: its former grass reference lay under the new shelter. The probe now
samples unobstructed grass instead; its lighting thresholds are unchanged.

Historical capture commands (on a revised head, use the revision README instead
to avoid overwriting this record). Run `grep MemAvailable /proc/meminfo` before
each heavy command, pause below 4 GB, and run the commands serially:

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy npm ci
/home/michael/OpenBot/Shared/farm-tools/heavy npm run build
/home/michael/OpenBot/Shared/farm-tools/heavy npm test
LIGHTING_URL=http://100.88.150.21:5213 EBR56_DEV_URL=http://100.88.150.21:5213 EBR46_URL=http://100.88.150.21:5213 EBR46_EVIDENCE_DIR=evidence/EBR-70/stairs EBR46_SLIDE_PROOF=evidence/EBR-70/stairs/slide-proof.json EBR70_URL=http://100.88.150.21:5213 EBR70_EVIDENCE_DIR=evidence/EBR-70/browser /home/michael/OpenBot/Shared/farm-tools/heavy npm run test:browser
EBR70_URL=http://100.88.150.21:5213 /home/michael/OpenBot/Shared/farm-tools/heavy node tools/ebr70-evidence.mjs
```

Keep `npm run dev -- --host 100.88.150.21 --port 5213 --strictPort` running
in this worktree for the URL-based captures.

The comparison tool archives clean commit `5d9ba48` into a temporary directory,
then uses the installed dependencies from this worktree; it does not change a
branch or another worktree. Sheep use URL `?seed=123`; the test harness seeds
the existing weather RNG separately before initialization, as `tools/parity.mjs`
does. Animation time, input, camera, phase and weather match between frames.
These are software-renderer results, not a physical-device or hardware-GPU test.
