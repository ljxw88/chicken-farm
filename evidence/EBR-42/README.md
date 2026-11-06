# EBR-42 visual evidence

- `baseline/` is clean main `5d9ba48f6bd9bfbc3974351b50d0ce89934380ff`, extracted by `git archive` without touching another worktree. `candidate/` is the running EBR-42 app. The 12 phase/weather combinations and walk, placement and stairs frames are 1280×720, DPR 1, Chromium/SwiftShader, with the normal 320×180 pixel pass.
- `mask/smoke/` and `mask/fireflies/` contain exact white-on-black masks measured by hiding just that effect in the *same* candidate frame; `mask/combined/` is their union. `diff/` is the raw main/candidate difference in magenta. `no-effects/` is the candidate with both effects hidden. `comparison.json` records counts, bounds, state, lights, errors and seeded replay.
- In `placement-night-clear` the existing translucent toolbar lies over part of the plume. Its composited pixel changes are included in the smoke mask; the toolbar itself is unmodified, and the no-effects frame still matches main exactly.
- `crops/` contains paired 3× nearest-neighbour crops and their combined masks. The chimney is shown both by day and at night; the firefly cluster is night-clear. `comparison.json` records their original rectangles. The smoke crop is centred on the measured plume, and the firefly crop is chosen to contain multiple visible mote components.
- Both scenes use seed `3950182401` (`0xeb730001`) and identical manually stepped render times. Main's existing rain RNG is injected at construction through the existing parity-test response hook; the candidate uses `?seed=3950182401`. Frame and weather randomness are not synchronized by wall-clock time.
- `?seed=` accepts an unsigned 32-bit decimal or hexadecimal integer. Without it, existing rain retains its normal random behavior; the new effects use fixed, independent visual RNG streams. The seed does not affect input, collision or placement.
- Smoke has five slots. A 3.2 s lifetime and a 0.6 s spawn interval mathematically require six overlapping puffs for 0.2 s, so a scheduled birth is skipped when the pool is full rather than killing a puff early. A 2.2 s rain lifetime naturally yields three or four live puffs at the same interval.
- The existing character replay still uses its historical `9e8c8c6` reference, now extracted with `git archive` instead of creating/removing a Git worktree. It retains exact input/pose traces and compares every frame both normally and with just these two effects hidden; all other pixels must still match. Its reference is separate from the required `5d9ba48` Gate G above.
- This host denies the current user write access to `/tmp/opencode`; both archive harnesses try it first, then fall back to a unique temporary directory under the system temp directory.

## Reproduce

With this worktree's `npm ci` complete and its dev server running on `100.88.150.21:5212`, check available memory before each command and pause below 4 GB:

```sh
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/capture.mjs
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-42/crop-day.py
```

The script fails on a state mismatch, any changed pixel outside the measured effect masks, a changed pixel after hiding the effects, a wrong stable-phase count, an invisible requested effect, an overbright firefly pixel, a firefly over the void, an application console/page error, or a nonidentical seeded replay. Existing favicon errors, if any, are recorded separately. It writes all frames and the report afresh. This is not a substitute for Look Dev's visual sign-off or hardware-GPU/device testing.
