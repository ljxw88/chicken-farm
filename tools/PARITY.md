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
existing browser tests; a minified production preview cannot expose this seam.
The URL option does not start or stop the supplied server.

Both runs use the same headless Chromium/SwiftShader, 1280×720, DPR 1, pixel
pass, pinned phase/weather URLs, LCG seed, manual animation-frame timestamps,
and input route/pose. The weather RNG is supplied at initialization, before
rain particles are created. The stairs frame is reached by a real click and
the day frame by WASD; placement uses the real selection and pointer path.
`baseline.json` records the source SHA, capture state and frame hashes. Each scenario saves
baseline, candidate, and a black/magenta exact-RGBA diff PNG under
`evidence/EBR-73/`; `parity.json` records the counts. Any differing pixel,
missing or altered baseline frame, page error, unexpected pose or browser-version mismatch fails
the command. Run on the same machine/browser as the baseline; browser, fonts,
or graphics changes can alter pixels even when application code does not.
For an external `--url`, the server's source SHA is unknown rather than inferred
from the local checkout. For a local run, `parity.json` records both HEAD and
any source changes present during capture.
