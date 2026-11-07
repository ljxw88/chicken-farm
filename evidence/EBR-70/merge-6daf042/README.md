# EBR-70 / EBR-75 merge evidence

These captures use the merged branch, 1280×720 at DPR 1, the 320×180 pixel
pass, Chromium/SwiftShader, visual seed 123 and a separately seeded rain RNG.
The comparison references are extracted from their exact Git commits with
`git archive`, not taken from an existing worktree.

* `main/` compares against clean main `6daf042ad85882f020268baf53fc92fb09e921ad`.
  White mask pixels are the rendered sheepfold, its shadows and, in the
  rejected-placement frame, the intentional changed placement feedback. The
  hidden-fold/feedback frame is also compared to main, so a mask cannot hide
  unrelated changes. Those paired renders are saved in `hidden-fold/` and
  `hidden-feature/`; `gate-g.json` contains per-frame counts and states.
* `previous/` compares against the complete pre-merge EBR-70 scene at
  `76a2181a2bc90b793b7dc58e21cc062d17d13dd6`. Nothing is hidden and no pixel
  change is allowed: the per-frame masks are black. It also compares the
  character, camera, lighting, weather, sheep head poses and sheep shadows.
* Both captures freeze and step the normal loop at identical times, seed rain,
  and use real input for walking, stairs and placement. They include fixed
  phases, weather transitions and an advancing day/night cycle. The pen frames
  use a test-only camera focus; normal-view sheep crops and part-pixel counts
  are in `browser/`.
* `browser/engine-integration.json` records the live engine obstacle entities,
  held/released clock, sheep nods and both farm/fold shadows in night rain.
  The WASD route and placement rejection keep every collision active.
* The inherited EBR-75 replay uses free tiles outside the added pen and hides
  the fold only while taking its historical fold-free reference screenshots;
  its collision entities stay active during all input and state comparisons.
  Its two original reference revisions and coverage assertions are retained.

The earlier `sheep-revision/` and root-level evidence remain historical records.
These deterministic comparisons do not establish a physical-device or hardware
GPU result, and do not convert EBR-75's real-time QA failure into a QA pass.

## Reproduce

Run from this worktree with the dev server at
`http://100.88.150.21:5213/` (`--host 100.88.150.21 --port 5213 --strictPort`).
Before **each** command check `grep MemAvailable /proc/meminfo`; pause below
4 GB. Run the heavy commands serially, and use fresh output directories if
preserving these committed captures.

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy npm ci
/home/michael/OpenBot/Shared/farm-tools/heavy npm run build
/home/michael/OpenBot/Shared/farm-tools/heavy npm test
LIGHTING_URL=http://100.88.150.21:5213 EBR56_DEV_URL=http://100.88.150.21:5213 EBR46_URL=http://100.88.150.21:5213 EBR46_EVIDENCE_DIR=evidence/EBR-70/merge-6daf042/stairs EBR46_SLIDE_PROOF=evidence/EBR-70/merge-6daf042/stairs/slide-proof.json EBR70_URL=http://100.88.150.21:5213 EBR70_EVIDENCE_DIR=evidence/EBR-70/merge-6daf042/browser EBR74_ROUTE_EVIDENCE_DIR=evidence/EBR-70/merge-6daf042/character-replay EBR75_REPLAY_EVIDENCE_DIR=evidence/EBR-70/merge-6daf042/engine-replay /home/michael/OpenBot/Shared/farm-tools/heavy npm run test:browser
EBR70_URL=http://100.88.150.21:5213 EBR70_GATE_DIR=evidence/EBR-70/merge-6daf042/main /home/michael/OpenBot/Shared/farm-tools/heavy node tools/ebr70-evidence.mjs
EBR70_URL=http://100.88.150.21:5213 EBR70_PREVIOUS_HEAD=1 EBR70_GATE_DIR=evidence/EBR-70/merge-6daf042/previous /home/michael/OpenBot/Shared/farm-tools/heavy node tools/ebr70-evidence.mjs
```
