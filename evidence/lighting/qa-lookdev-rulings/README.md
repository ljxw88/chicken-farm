# EBR-80 final QA matrix

Captured from the final local worktree before commit, Chromium/SwiftShader, 1280×720, with the live server at `http://100.88.150.21:5184`.

```sh
PW_RESOLVE_DIR="$PWD/" node /home/michael/OpenBot/Shared/qa-graphics-gate/gfx-matrix.mjs http://100.88.150.21:5184 <output-dir>
ANIM_MASKS='500,540,550,668' python3 /home/michael/OpenBot/Shared/qa-graphics-gate/analyze-gate.py <output-dir>
C4_STRICT=1 ANIM_MASKS='500,540,550,668' python3 /home/michael/OpenBot/Shared/qa-graphics-gate/analyze-gate.py <output-dir>
python3 tools/summarize-qa-matrix.py <output-dir>
```

The default report is **92 PASS, 4 INFO, 1 FAIL / 97**. The FAIL is G5's pad origin-gap check; three INFO rows are night C4 values below the newly requested threshold. Strict C4 produces **4 FAIL / 97**. `metrics.json` records the exact QA sampling values; see `docs/lighting-audit.md` for the pad receiver evidence and the distinction between QA C4 and shade-versus-grass ΔE.

QA tool SHA-256: `gfx-matrix.mjs` `358fd300e9cc3b739e1f263ce71813b6494012ad898b12f8e4b1a325818847a1`; `analyze-gate.py` `4b02fad560b85c48dce083a51d6ba81d132169878f2389ea5bbb9d875d2d0103`.
