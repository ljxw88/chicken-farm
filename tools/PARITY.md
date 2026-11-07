# Gate G pixel parity

Install dependencies and Chromium (`npm ci`, `npx playwright install chromium`).
Record the main-branch commit **once at slice start**, then keep those files; an
ordinary comparison never replaces them:

```sh
npm run parity -- --record-baseline --baseline-sha <origin/main SHA>
npm run parity
```

The baseline is served from a temporary `git archive` of that exact commit, not
the working tree. The candidate defaults to the current Vite source tree. To
compare another running Vite source server, use `npm run parity -- --url
http://host:port`. The test instruments its served `/src/main.ts` just like the
existing browser tests and seeds weather in its registered environment module;
a minified production preview cannot expose this seam.
The URL option does not start or stop the supplied server.

Both runs use the same headless Chromium/SwiftShader, 1280×720, DPR 1, pixel
pass, pinned phase/weather URLs, LCG seed, manual animation-frame timestamps,
and input route/pose. The weather RNG is supplied at initialization, before
rain particles are created. The stairs frame is reached by a real click and
the day frame by WASD; placement uses the real selection and pointer path.
The pinned EBR-76 placement pointer uses an open patch outside the sheepfold;
fold-free historical captures retain their original target. For a new baseline,
`PARITY_PLACEMENT_Y` can select another screen Y; it is recorded and reused for
both sides of subsequent comparisons.
Two extra day/night frames use a test-only camera focus and zoom, retaining the
normal isometric front direction, to frame the cottage and both coops without
moving the character. They use the existing composer and also check the window
lights and window/pop-hole emissives.
`baseline.json` records the source SHA, capture state and frame hashes. Each scenario saves
baseline, candidate, and a black/magenta exact-RGBA diff PNG under
`evidence/EBR-73/`; `parity.json` records the counts. Any differing pixel,
missing or altered baseline frame, page error, unexpected pose or browser-version mismatch fails
the command. Run on the same machine/browser as the baseline; browser, fonts,
or graphics changes can alter pixels even when application code does not.
For an external `--url`, the server's source SHA is unknown rather than inferred
from the local checkout. For a local run, `parity.json` records both HEAD and
any source changes present during capture.

`PARITY_HOST` and `PARITY_PORT` optionally select a local strict-port server.
`PARITY_OUTPUT_DIR` writes candidate, diff and report there while still reading
the immutable baseline from `PARITY_EVIDENCE_DIR`. This lets a final-tip check
retain its exact SHA without modifying previously committed evidence.

EBR-76 pins `b41492e` even if `origin/main` has since advanced. Its scene
reference is an exact, pooled gzip fixture: `node tools/scene-data-dump.mjs
--against-main <clean-b41492e-worktree>` reconstructs and compares all original
JSON bytes. `node tools/placement-environment-replay.mjs --against-main
<clean-b41492e-worktree> <evidence-dir>` compares full, unmasked replay frames
and traces, including the fold and effects, with zero changed pixels allowed.
The evidence directory includes an all-black `mask/no-changes-1280x720.png`.

For EBR-80, leave the signed `evidence/EBR-73/` files untouched. Copy its
`baseline.json` and `baseline/` into a separate directory and run, for example,
`PARITY_EVIDENCE_DIR=evidence/lighting/gate-g npm run parity`. Do not re-record
the baseline until Look Dev signs. On the EBR-48 layout the stairs capture uses
real clicks along the bridge route; the old direct click crosses the new water.
The old baseline's stair pose and the WASD walk can therefore differ as well as
the intentionally lit pixels. `npm run lighting:parity` adds sunset/cloudy
scenarios against its separately recorded pre-lighting reference.
