# EBR-70 sheep silhouette revision

The 1280×720 `browser/visibility-*-full.png` images use the ordinary, unzoomed
game camera, DPR 1 and the actual 320×180 pixel pass. The `*-sheep-*-4x.png`
images are nearest-neighbour enlargements of crops from those same frames.
`browser/visibility.json` counts wool, face and legs for both animals at 0, 1,
2 and 3 seconds in daytime, sunset and night. A pixel is attributed to a part
only when hiding that part changes an RGB channel by at least 3. `maxRun` is
the longest contiguous horizontal run in the 320×180 buffer. The diagnostic
`*-parts.png` masks are 320×180: white = wool, red = face, cyan = legs. The
unchanged fence and other scene objects remain visible during these measurements.
Part masks can overlap; JSON counts each part independently, while the diagnostic
image gives legs then face priority over wool at shared pixels. The two visible
near legs each have a >=2-pixel run in every sampled frame; far-side legs can
be occluded by wool or the unchanged fence.

`main-gate/` compares the revised scene against clean main `5d9ba48`; its exact
declared masks are in `../mask/main-revision/`. `delta/` compares against the
accepted pen at `8ce0cbe`; masks in `../mask/sheep-revision/` are the union of
the old and new visible sheep pixels. In the delta comparison, hiding only the
two sheep in both scenes leaves the accepted fence, lean-to and all shadows
visible, and those hidden-sheep frames must match exactly. `diff/` is magenta
where full frames differ; white mask pixels are permitted, black are not.

The browser route and stair proof are regenerated in `browser/` and `stairs/`;
`browser/wool-cycle.json` checks the highlight limit through the day/weather
matrix. `night-weather/` contains clear/cloudy/rain night frames and intrinsic
wool measurements: rain particles are hidden only while measuring wool hue,
with weather lighting unchanged. The top-level `build.log`, `unit.log`,
`browser-suite.log`, `night-weather.log`, `main-gate.log` and `delta-gate.log`
record the locked verification runs.

Reproduce from the worktree with its dev server running on port 5213. Before
each heavy command run `grep MemAvailable /proc/meminfo`, pause below 4 GB,
and run the commands serially through `/home/michael/OpenBot/Shared/farm-tools/heavy`.
Start the reviewer server with `npm run dev -- --host 100.88.150.21 --port 5213 --strictPort`.
The normal app seed is `?seed=123`; the capture harness separately seeds the
existing rain RNG and manually steps animation time, as in `tools/parity.mjs`.
The results use headless Chromium/SwiftShader, not a physical device or hardware GPU.

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy npm ci
/home/michael/OpenBot/Shared/farm-tools/heavy npm run build
/home/michael/OpenBot/Shared/farm-tools/heavy npm test
LIGHTING_URL=http://100.88.150.21:5213 EBR56_DEV_URL=http://100.88.150.21:5213 EBR46_URL=http://100.88.150.21:5213 EBR46_EVIDENCE_DIR=evidence/EBR-70/sheep-revision/stairs EBR46_SLIDE_PROOF=evidence/EBR-70/sheep-revision/stairs/slide-proof.json EBR70_URL=http://100.88.150.21:5213 EBR70_EVIDENCE_DIR=evidence/EBR-70/sheep-revision/browser /home/michael/OpenBot/Shared/farm-tools/heavy npm run test:browser
EBR70_URL=http://100.88.150.21:5213 /home/michael/OpenBot/Shared/farm-tools/heavy node evidence/EBR-70/sheep-revision/night-weather-proof.mjs
EBR70_URL=http://100.88.150.21:5213 EBR70_GATE_DIR=evidence/EBR-70/sheep-revision/main-gate EBR70_MASK_DIR=evidence/EBR-70/mask/main-revision /home/michael/OpenBot/Shared/farm-tools/heavy node tools/ebr70-evidence.mjs
EBR70_URL=http://100.88.150.21:5213 EBR70_SHEEP_DELTA=1 EBR70_GATE_DIR=evidence/EBR-70/sheep-revision/delta EBR70_MASK_DIR=evidence/EBR-70/mask/sheep-revision /home/michael/OpenBot/Shared/farm-tools/heavy node tools/ebr70-evidence.mjs
```
