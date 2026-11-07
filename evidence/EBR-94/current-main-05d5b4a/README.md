# EBR-94 integration evidence

- Clean main: `05d5b4aa566bf3d48cd2d1f5b94224224287c4c2`.
- Captured source: `0b483a36de90f841b31d23514384ad1d5ac43dfe`; the following evidence-only commit does not change source, tests, or tools. The SHA-256 of `git diff --binary 05d5b4a 0b483a3 -- src tests tools` is `f92f2174c060c7ecd6c8404f76e4ad7799940ecc03309149e7a31ae2964a65fb`.
- Intended same-pose pixel changes: none; the allowed mask is empty. `gate-g/` compares all eight unmasked frames to a clean archive of current main: zero changed pixels and zero state mismatches. The signed EBR-92 character look is part of both sides.
- `stairs.log`, `stairs/`, and `long-repro/` record four passing browser tests. All three pad-side routes reached the path with no unsupported frames or browser errors. The controlled long return reached `(13.15, 0.16, 0.55001)` in 618 sampled frames.
- The old `../gate-g/` and `../main-repro/` evidence is retained as historical evidence from main `5d9ba48`. When comparing that older main to the current branch, EBR-92's signed body changes must be attributed to EBR-92 rather than to this stair fix.
- Captures use Chromium 153.0.8010.12, SwiftShader, 1280×720, DPR 1. The unusually small lateral offset in the controlled long-return repro is synthetic, not a normal display-frame timing.

To review, walk across the bridge and down to the foot pad. Push into either pad side, then climb back toward the path with W+A. Repeat S+A then W+A, W+D then W+A, and S+D/S+A/W+D then W+A; the character should return without pinning or leaving the visible ground.

All commands were run serially through `/home/michael/OpenBot/Shared/farm-tools/heavy`, after checking available memory. The shared dev server used port 5214 with `--strictPort`.
