# EBR-42 visual evidence

## Current merge

- `merge-05d5b4a/qa-gate/` directly compares QA's checked-in copy of the eight
  frames and metadata from `/home/michael/OpenBot/Shared/qa-graphics-gate/gate-g-baseline-05d5b4a/`.
  `candidate/` and `diff/` show the final merged scene and raw differences.
  `no-smoke/`, `no-fireflies/` and `no-effects/` isolate the exact same state;
  `mask/smoke/`, `mask/fireflies/` and `mask/combined/` are exact pixel masks.
  The combined mask also includes any quantized interaction only visible when
  both effects are hidden. `parity.json` records frame counts and state.
- `merge-05d5b4a/luma-frames/`, `luma-no-smoke/`, `luma-masks/` and
  `readability.json` measure 27 smoke-mask frames at 2.5, 3.0 and 3.5 seconds
  across daytime/sunset/night and clear/cloudy/rain. Per-puff bright masks in
  `mask/puff-bright/` are diagnostic; Look Dev's current gate is the composite
  smoke-mask peak and night-window contrast, not three independent puffs.
- `merge-05d5b4a/{build,unit,browser,qa-gate,readability,masks}.log` record
  the checks on the merged source/test/tool trees. `replay/` records the strict
  historical character, placement and environment comparisons; `stairs/`
  records the real-input pad routes. Runtime/test/tool tree IDs are in each
  capture's source snapshot and in `DELIVER-EBR-42.txt`.
- `merge-05d5b4a/verify-masks.py` independently recomputes every mask and raw
  difference from the saved PNGs. `verify-final.mjs` checks a clean committed
  tip against fresh scratch-only logs, source trees, eight QA frames, the
  pre-EBR-92 same-pose comparison and all 27 luma samples.

## Retune and historical evidence

- `retune-468b4f3/merge-6daf042/same-pose.json` and its `previous/`,
  `candidate/`, `diff/` and `mask/smoke-retune/` compare retuned commit
  `114e2afa2cedfabc82c9d438eb27a3dfb8825232` against the hash-verified
  pre-merge `468b4f3` frames. The candidate was served from a clean checkout
  on `127.0.0.1:5222`. All differences stay inside old/new smoke masks;
  smoke-hidden frames and firefly state/masks match. This was before EBR-92.
- `retune-468b4f3/smoke-retune/` contains the corresponding pre-EBR-92
  readability measurements and paired crops. `capture.mjs` reproduces this
  historical comparison when run from the clean `114e2af` checkout.
- Root-level frames and `merge-6daf042/` record the earlier, pre-retune merge
  against main `6daf042`; their zero-change and 90%-hold results are historical,
  not claims about the current head. Their old `verify-final.mjs` validates that
  older handoff only. No historical reference was re-recorded.
- All captures use seeded, manually stepped animation in Chromium/SwiftShader
  at 1280x720, DPR 1 with the normal 320x180 pixel pass. `?seed=3950182401`
  fixes visual effects and rain without affecting gameplay; effect RNG streams
  are independent. Look Dev sign-off and hardware-device coverage are separate.

## Reproduce the committed tip

Use a clean checkout with installed dependencies and choose an absolute scratch
directory outside it. The helper serves that checkout on `127.0.0.1:5222` only
for the wrapped command and terminates only its own Vite process. Check
`MemAvailable` before every command and wait below 4 GB; `heavy` also guards
memory and waits for the shared queue. Run commands serially.

```sh
mkdir -p "$SCRATCH"
export EBR42_EVIDENCE_ROOT="$SCRATCH/evidence"
export EBR42_MEASUREMENT_DIR=merge-05d5b4a
export EBR42_SMOKE_OUT="$SCRATCH/evidence/merge-05d5b4a"
export EBR42_SMOKE_MASK_DIR="$SCRATCH/evidence/merge-05d5b4a/mask/puff-bright"
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy npm run build > "$SCRATCH/build.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy npm test > "$SCRATCH/unit.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy env \
  EBR46_URL=http://127.0.0.1:5222 EBR46_EVIDENCE_DIR="$SCRATCH/stairs" \
  EBR46_SLIDE_PROOF="$SCRATCH/stairs/pad-sequences.json" EBR56_DEV_URL=http://127.0.0.1:5222 \
  LIGHTING_URL=http://127.0.0.1:5222 EBR75_DCB_BASELINE_WORKTREE= EBR75_MAIN_BASELINE_WORKTREE= \
  EBR75_REPLAY_EVIDENCE_DIR= EBR74_ROUTE_EVIDENCE_DIR= \
  node evidence/EBR-42/merge-05d5b4a/with-vite.mjs npm run test:browser > "$SCRATCH/browser.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/merge-05d5b4a/with-vite.mjs \
  node evidence/EBR-42/merge-05d5b4a/qa-gate.mjs > "$SCRATCH/qa-gate.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/merge-05d5b4a/with-vite.mjs \
  node evidence/EBR-42/smoke-retune/measure.mjs > "$SCRATCH/readability.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-42/merge-05d5b4a/verify-masks.py \
  "$SCRATCH/evidence/merge-05d5b4a/qa-gate" > "$SCRATCH/masks.log" 2>&1
grep MemAvailable /proc/meminfo
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-42/merge-05d5b4a/verify-final.mjs "$SCRATCH"
```
