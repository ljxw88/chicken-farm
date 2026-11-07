# EBR-92 evidence — blocked on the contrast rule

Tested source: `6fbfec8a435824cf10635f36698d111796ed461d`; clean main:
`5d9ba48f6bd9bfbc3974351b50d0ce89934380ff`. Captures use Chromium
153.0.8010.12, SwiftShader, 1280×720, DPR 1. The normal game still uses the
4-CSS-pixel pass; `crisp/` is native resolution for measurements only.

## What to open

- `crops/{before,after}-{daytime,sunset,night}-clear-{toward,away}-3.5x.png`
  are 128×112 crops of the real pixel-pass frames, enlarged to 448×392 with
  nearest-neighbour. Full frames are in `before/frames/` and `after/frames/`.
- `gate-g-official/` is the unmodified Gate G run against QA's clean-main
  baseline. The stock all-zero assertion exits 1 for the intentional body
  changes. `logs/gate-g-mask.log`, `mask/before-vs-after/`, and
  `gate-g-official/mask-verification.json` prove zero changes outside the
  independently rendered body silhouette and zero changes in the complete
  body-hidden frames. The protected-phase masks are all black.
- `matrix-before/` and `matrix-after/` contain the **unmodified** QA matrix
  capture and analyzer output. `paired-before/` and `paired-after/` use the
  same analyzer, but substitute frozen, same-pose, rain-hidden crisp-away
  measurement frames; symlinks point to the retained full frames. Their
  `STRICT-RESULT.txt` files restore C4 as a hard check. `before/metrics.json`
  and `after/metrics.json` also retain unrounded values and the independent
  mean-based measurements.
- `step1/` and `matrix-step1/` are the first prescribed crown-only attempt.
  `maxgain/` and `matrix-maxgain/` preserve the initial 8% gain applied to
  cloudy weather too, which made the existing cloudy K1 check fail. The final
  source fades only the extra base gain out in cloud. `diagnostic-112/` is a
  **test-only**, out-of-spec 12% gain, never production code; see below.
- `stairs/pad-sequences.json`, `route/parity.json`, `lighting/`, and `logs/`
  contain the browser, movement and shade/lit checks. The recorded reference
  trace is copied to `route/baseline-trace.json`; the original `tracePath` in
  `route/parity.json` names the temporary clone used during that run.

## Contrast methodology and outcome

The supplied `analyze-gate.py` C4 actually uses per-channel **medians of 12
body and six ground pixels**, not the ticket's mean-body/ground-ring rule.
The matrix's real-time W hold also changes the ground sample when the machine
is loaded. The raw main clear/rain results were 1.11/1.05; the raw final
matrix printed 1.60/1.73 after walking farther. Those raw captures are not a
same-position comparison.

The paired captures use a seeded weather RNG and manual frames, holding W for
0.2334 s to reproduce main's sampled position `(-0.577636, 2.4, -0.577636)`.
Weather and lighting remain active; only rain particles are hidden for the
colour and G2 measurements. At that identical pose:

| Check | Main | Crown only | Final | Rule |
|---|---:|---:|---:|---|
| QA median, clear | 1.1097 / dE 10.66 | 1.0424 / dE 10.55 | **1.0163 / dE 10.30** | ≥1.15 or dE ≥25 |
| QA median, rain | 1.0128 / dE 10.14 | 1.0641 / dE 10.65 | **1.1294 / dE 10.94** | ≥1.15 or dE ≥25 |
| Spec mean, clear | 1.2080 / dE 18.11 | 1.2623 / dE 18.72 | 1.3366 / dE 19.64 | ≥1.15 or dE ≥25 |
| Spec mean, rain | 1.3044 / dE 18.22 | 1.3604 / dE 18.93 | 1.4379 / dE 19.98 | ≥1.15 or dE ≥25 |

The independent mean measures visible body pixels isolated by a body-hidden
render, and a uniform world-grid annulus of visible grass/path samples from
0.7 to 1.5 units around the feet (450 samples in the away pose). Colours are
averaged in sRGB before the QA gamma-2.2 luminance/CIE76 calculation. This
is not a claim that QA's median-based gate passes.

The clear sample's ground is brighter than the main body, so brightening the
body moves the median colours *closer* together. The rain value clears the
exception's numeric 1.08 floor but remains under 1.15. A test-only 12% base
gain produced 1.1508 with shade/lit 0.7738: it violates the 8% cap without
violating the rain shade/lit floor. Therefore the written condition for the
rain exception is not established; Look Dev/QA must resolve it as well as the
clear median failure. No out-of-spec gain is shipped.

## Other checks

The final same-pose rain-hidden shade/lit values are: morning clear 0.6901,
day clear 0.6997, sunset clear 0.7212; cloudy morning/day/sunset
0.7428/0.7521/0.7655; rain morning/day/sunset 0.7624/0.7735/0.7724.
All five specified floors pass. Cloudy K1 exact-sRGB dE is 25.078 (floor 25).
All 18 non-day phase/weather/facing frames and their measurement records are
bit-identical to clean main. Phase transitions interpolate smoothly; values
between the protected phase anchors are not claimed to be unchanged.

The raw final QA analyzer exits 1 for the visible-rain morning G2 sample
(0.74) and its older M1 vertex cap of 1.15. Rain-hidden G2 is 0.7624; EBR-92
explicitly permits the higher crown, but the external analyzer has not been
changed. The paired analyzer exits 1 for that old M1 cap; with `C4_STRICT=1`
it reports five C4 failures (morning clear, day clear/cloudy/rain, sunset
clear) plus M1. The same five C4 failures already exist on the paired main
capture, although day-clear's value has worsened. None is silently waived.

## Reproduction

Run heavy commands serially through `/home/michael/OpenBot/Shared/farm-tools/heavy`
after checking available memory. The normal server is
`http://100.88.150.21:5211`. For example:

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-92/capture-main.mjs
/home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-92/capture.mjs http://100.88.150.21:5211 after
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-92/analyze.py before
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-92/analyze.py after before
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-92/verify-gate-g.py
/home/michael/OpenBot/Shared/farm-tools/heavy python3 evidence/EBR-92/prepare-paired-qa.py after
ANIM_MASKS='500,540,550,668' C4_STRICT=1 /home/michael/OpenBot/Shared/farm-tools/heavy python3 /home/michael/OpenBot/Shared/qa-graphics-gate/analyze-gate.py evidence/EBR-92/paired-after
```

`capture-main.mjs` serves a `git archive` of the exact main SHA; it does not
check out or change another worktree. The captures inject the existing weather
RNG with seed `0xeb730001` before initialization, just like `tools/parity.mjs`.
No production randomness or `?seed` parameter was added. Browser test setup
uses a separate disposable clone of the historic 9e8c8c6 replay reference;
the test's own forced worktree removal is not invoked.
