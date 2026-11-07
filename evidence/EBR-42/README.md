# EBR-42 visual evidence

- `baseline/` is clean main `6daf042ad85882f020268baf53fc92fb09e921ad`, extracted by `git archive` without touching another worktree. `candidate/` is the merged EBR-42 app. The 12 phase/weather combinations and walk, placement and stairs frames are 1280×720, DPR 1, Chromium/SwiftShader, with the normal 320×180 pixel pass.
- `mask/smoke/` and `mask/fireflies/` contain exact white-on-black masks measured by hiding just that effect in the *same* candidate frame; `mask/combined/` is their union. `diff/` is the raw main/candidate difference in magenta. `no-effects/` is the candidate with both effects hidden. `comparison.json` records counts, bounds, state, lights, errors and seeded replay.
- `merge-6daf042/qa-gate/` compares the eight frames from `/home/michael/OpenBot/Shared/qa-graphics-gate/gate-g-baseline-6daf042/` directly, verifying their recorded hashes and pose/state. It contains the candidate and isolated-effect frames, exact smoke/firefly/combined masks, raw diffs, effect-hidden frames and per-frame parity counts. The combined mask also includes any quantized pixel revealed only by hiding both effects together.
- `smoke-retune/before/` and `smoke-retune/diff/` compare the new build to signed firefly head `9305bd41ed71f1d885646ac5d9b1bc145fb2594e`. `mask/smoke-retune/` is the union of old/new smoke contributions; the checker also requires identical firefly masks and opacities. `smoke-retune/crops/` pairs the old/new chimney with its mask for day and sunset in clear/rain and for all three night weathers.
- `merge-6daf042/previous/`, `merge-6daf042/candidate/`, `merge-6daf042/diff/` and `merge-6daf042/same-pose.json` compare every full merged frame with its committed pre-merge `468b4f3b2bc415d69ec0e52575de127c2035e1a8` frame. The harness verifies the old frame hash, seed, browser, viewport, complete captured pose/state and effect state before checking every pixel; it also verifies that the previous evidence commit did not change the source used for that capture.
- `merge-6daf042/no-smoke/` and `merge-6daf042/no-fireflies/` preserve same-frame effect-isolation screenshots for those 15 cases.
- `merge-6daf042/luma-frames/`, `merge-6daf042/luma-no-smoke/`, `merge-6daf042/luma-masks/` and `merge-6daf042/readability.json` record each merged-source frame, its same-state smoke-hidden counterpart, the exact mask and measurements at 2.5, 3.0 and 3.5 seconds for each day/sunset/night weather combination.
- `source-snapshot.mjs` rejects unstaged or untracked runtime/test/tool inputs and records the exact Git index trees and HTML/package blobs. This allows evidence to be captured before its encompassing commit; the recorded trees can be checked against that commit afterward.
- `merge-6daf042/verify-final.mjs <scratch-directory>` checks the final clean HEAD against those trees, final-tip build/unit/browser logs, the direct QA-baseline counts, all 15 previous-head frame comparisons and the 27 luma samples. It writes its verification report only into the supplied scratch directory.
- `smoke-retune/readability.json` measures actual per-puff contributions at 2.5, 3.0 and 3.5 seconds across day/sunset/night and each weather. `mask/puff-bright/` shows the t=3 pixels on pure void where an individual puff contributes at least 5 luminance units to a pixel meeting the phase threshold. Overlapping puffs can share pixels; the JSON separately reports exclusive and isolated-puff peaks and a lights/fog-off non-emission check. **The unchanged smoke does not establish three independently readable puffs in every frame:** sunset-rain has no isolated puff at 110 in these samples, and some samples have fewer than three exclusive bright puffs. The later Look Dev rule no longer requires three individually readable puffs.
- In `placement-night-clear` the existing translucent toolbar lies over part of the plume. Its composited pixel changes are included in the smoke mask; the toolbar itself is unmodified, and the no-effects frame still matches main exactly.
- `crops/` contains paired 3× nearest-neighbour crops and their combined masks. The chimney is shown both by day and at night; the firefly cluster is night-clear. `comparison.json` records their original rectangles. The smoke crop is centred on the measured plume, and the firefly crop is chosen to contain multiple visible mote components.
- Both scenes use seed `3950182401` (`0xeb730001`) and identical manually stepped render times. Main's existing rain RNG is injected at construction through the existing parity-test response hook; the candidate uses `?seed=3950182401`. Frame and weather randomness are not synchronized by wall-clock time.
- `?seed=` accepts an unsigned 32-bit decimal or hexadecimal integer. Without it, existing rain retains its normal random behavior; the new effects use fixed, independent visual RNG streams. The seed does not affect input, collision or placement.
- Smoke now has six slots. A 3.6 s lifetime and a 0.55 s interval require seven overlapping puffs for 0.30 s, so a scheduled birth is skipped when the pool is full rather than killing a puff early. A 2.6 s rain life yields four or five live puffs. Rain and night each select a 60% opacity factor; when both are active they do not compound below 60%.
- The merge preserves the prior smoke appearance and its 90%-life opacity hold. The separately requested 40%-hold, size-variance and lateral-sway retune was not applied under the no-look-change direction.
- The smoke material remains non-emissive and scene-lit with base `0xefe3c8`. To reach the requested luma under the signed lighting, its reflected result is boosted 9× and uniformly capped at its albedo; no light or emissive floor is added. The probe verifies no brightening with scene lights and fog removed.
- The existing character replay still uses its historical `9e8c8c6` reference, extracted with `git archive`. It retains exact input/pose traces and compares every frame both normally and with just these two effects hidden; all other pixels must still match. Its historical reference is separate from the `6daf042` Gate G above. EBR-75's placement/environment replay also uses clean archives by default, compares with only the intended effects hidden and records raw diffs; its historical test references do not replace the new Gate G baseline.
- `character-replay-test.log`, `character-replay-tmp-permission.log`, `browser-initial-effect-diff.log` and `browser-test.log` are retained from before the merge. Current build, unit and browser logs are in `merge-6daf042/`.
- This host denies the current user write access to `/tmp/opencode`; the archive harnesses try it first, then fall back to a unique temporary directory under the system temp directory.

## Reproduce

With this worktree's `npm ci` complete and its dev server running on `100.88.150.21:5212`, check available memory before each command and pause below 4 GB. Set `EBR42_EVIDENCE_ROOT` to an isolated directory to reproduce without modifying the committed evidence:

```sh
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/smoke-retune/measure.mjs
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/capture.mjs
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/merge-6daf042/qa-gate.mjs
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-42/crop-day.py
```

The readability probe checks smoke-mask peaks and night-window contrast in every sampled case; per-puff overlap counts are diagnostic only, not a three-puff gate. The capture fails on its pixel, scene-state, signed-firefly, mask, error or replay assertions, including any full-frame pixel change relative to the previous head. Existing favicon errors, if any, are recorded separately. They write all frames and the report afresh. This is not a substitute for Look Dev's visual sign-off or hardware-GPU/device testing.

## Verify the committed tip without dirtying it

Choose a new writable scratch directory, set `SCRATCH` to it, and keep the review server on port 5212. The archive-based EBR-75 replay references are selected explicitly so no other worktree is used.

```sh
mkdir -p "$SCRATCH"
export EBR42_EVIDENCE_ROOT="$SCRATCH/evidence"
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy npm run build > "$SCRATCH/build.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy npm test > "$SCRATCH/unit.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/smoke-retune/measure.mjs > "$SCRATCH/readability.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/capture.mjs > "$SCRATCH/capture.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/merge-6daf042/qa-gate.mjs > "$SCRATCH/qa-gate.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-42/crop-day.py > "$SCRATCH/day-crops.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy env \
  EBR46_URL=http://100.88.150.21:5212 EBR46_EVIDENCE_DIR="$SCRATCH/stairs" \
  EBR46_SLIDE_PROOF="$SCRATCH/stairs/pad-sequences.json" EBR56_DEV_URL=http://100.88.150.21:5212 \
  LIGHTING_URL=http://100.88.150.21:5212 EBR75_DCB_BASELINE_WORKTREE= EBR75_MAIN_BASELINE_WORKTREE= \
  EBR75_REPLAY_EVIDENCE_DIR= EBR74_ROUTE_EVIDENCE_DIR= npm run test:browser > "$SCRATCH/browser.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/merge-6daf042/verify-final.mjs "$SCRATCH"
```
