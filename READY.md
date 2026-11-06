# EBR-80 — engineering handoff, QA gate not green

- Branch: `fix/lighting-direction`; tip: `git rev-parse HEAD` (exact SHA in the accompanying response).
- Base: `c59b0433e4bec1b7d7dce6e69833dab6d64bdbaa`; pre-rebase tag: `pre-rebase-light`.
- PR: not opened or pushed because publishing was conditional on green gates.
- Open http://100.88.150.21:5184/?phase=sunset&weather=clear and the seven fixed URLs in `DELIVER.txt`.
- Frames: `evidence/lighting/review-{before,after}-*-full.png`, `*-water.png`, and the day/sunset/night `*-{toward,away}-crop.png` files.
- Build, 117 unit tests and 30 browser tests passed. The supplied QA analyzer still reports 10 failures: specified cloud/rain offset versus C2, daytime luminance versus hue allowance, and the intentionally animated EBR-48 waterfall versus C5.
- Engineer retained the specified offsets and signed palette; QA/Look Dev must resolve the conflicts before publishing or re-baselining Gate G. Details and per-phase/facing numbers: `docs/lighting-audit.md` and `DELIVER.txt`.
