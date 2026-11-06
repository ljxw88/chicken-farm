# EBR-42 visual evidence

- `baseline/` is clean main `5d9ba48f6bd9bfbc3974351b50d0ce89934380ff`, extracted by `git archive` without touching another worktree. `candidate/` is the retuned app. The 12 phase/weather combinations and walk, placement and stairs frames are 1280×720, DPR 1, Chromium/SwiftShader, with the normal 320×180 pixel pass.
- `mask/smoke/` and `mask/fireflies/` contain exact white-on-black masks measured by hiding just that effect in the *same* candidate frame; `mask/combined/` is their union. `diff/` is the raw main/candidate difference in magenta. `no-effects/` is the candidate with both effects hidden. `comparison.json` records counts, bounds, state, lights, errors and seeded replay.
- `smoke-retune/before/` and `smoke-retune/diff/` compare the new build to signed firefly head `9305bd41ed71f1d885646ac5d9b1bc145fb2594e`. `mask/smoke-retune/` is the union of old/new smoke contributions; the checker also requires identical firefly masks and opacities. `smoke-retune/crops/` pairs the old/new chimney with its mask for day and sunset in clear/rain and for all three night weathers.
- `smoke-retune/readability.json` measures actual per-puff contributions at 2.5, 3.0 and 3.5 seconds across day/sunset/night and each weather. `mask/puff-bright/` shows the t=3 pixels on pure void where an individual puff contributes at least 5 luminance units to a pixel meeting the phase threshold. Overlapping puffs can share pixels; the JSON separately reports exclusive and isolated-puff peaks and a lights/fog-off non-emission check. **The contribution check is not proof that three puffs are independently readable in every frame:** sunset-rain has no isolated puff at 110 in these samples, and some samples have fewer than three exclusive bright puffs. These limitations are recorded in the JSON and require Look Dev judgment.
- In `placement-night-clear` the existing translucent toolbar lies over part of the plume. Its composited pixel changes are included in the smoke mask; the toolbar itself is unmodified, and the no-effects frame still matches main exactly.
- `crops/` contains paired 3× nearest-neighbour crops and their combined masks. The chimney is shown both by day and at night; the firefly cluster is night-clear. `comparison.json` records their original rectangles. The smoke crop is centred on the measured plume, and the firefly crop is chosen to contain multiple visible mote components.
- Both scenes use seed `3950182401` (`0xeb730001`) and identical manually stepped render times. Main's existing rain RNG is injected at construction through the existing parity-test response hook; the candidate uses `?seed=3950182401`. Frame and weather randomness are not synchronized by wall-clock time.
- `?seed=` accepts an unsigned 32-bit decimal or hexadecimal integer. Without it, existing rain retains its normal random behavior; the new effects use fixed, independent visual RNG streams. The seed does not affect input, collision or placement.
- Smoke now has six slots. A 3.6 s lifetime and a 0.55 s interval require seven overlapping puffs for 0.30 s, so a scheduled birth is skipped when the pool is full rather than killing a puff early. A 2.6 s rain life yields four or five live puffs. Rain and night each select a 60% opacity factor; when both are active they do not compound below 60%.
- The smoke material remains non-emissive and scene-lit with base `0xefe3c8`. To reach the requested luma under the signed lighting, its reflected result is boosted 9× and uniformly capped at its albedo; no light or emissive floor is added. The probe verifies no brightening with scene lights and fog removed.
- The existing character replay still uses its historical `9e8c8c6` reference, now extracted with `git archive` instead of creating/removing a Git worktree. It retains exact input/pose traces and compares every frame both normally and with just these two effects hidden; all other pixels must still match. Its reference is separate from the required `5d9ba48` Gate G above.
- `character-replay-test.log`, `character-replay-tmp-permission.log` and `browser-initial-effect-diff.log` are retained from the signed pre-retune work. The current character-replay result is in `browser-test.log`.
- This host denies the current user write access to `/tmp/opencode`; both archive harnesses try it first, then fall back to a unique temporary directory under the system temp directory.

## Reproduce

With this worktree's `npm ci` complete and its dev server running on `100.88.150.21:5212`, check available memory before each command and pause below 4 GB:

```sh
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/smoke-retune/measure.mjs
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/capture.mjs
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-42/crop-day.py
```

The readability probe checks composite contributions in every sampled case and independent bright pixels only in five named t=3 cases; it separately records samples where the stronger independent criterion is not met. The capture fails on its pixel, scene-state, signed-firefly, mask, error or replay assertions. Existing favicon errors, if any, are recorded separately. They write all frames and the report afresh. This is not a substitute for Look Dev's visual sign-off or hardware-GPU/device testing.
