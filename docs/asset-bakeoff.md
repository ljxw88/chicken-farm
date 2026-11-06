# Asset Forge bake-off — preliminary, incomplete

## EBR-83–85 continuation on main 5d9ba48

**Still blocked; no winner can be chosen.** After EBR-80 was merged, the
free OpenCode provider returned HTTP 429 `provider.free-limit` for both the
configured `opencode/crouton-alpha-free` and the alternative
`opencode/nemotron-3.5-super-vl-free` (retry window approximately 3h20m).
No paid key or paid model was used. The image probe immediately beforehand
passed 3/3 on `opencode/crouton-alpha-free`; subsequent generation could not
proceed. The tool emits work orders and marks the visual critique **not run**.
No new B sessions were started because the same free provider was unavailable;
the installed Apache-2.0 skill remains outside this repository. The per-asset
30-minute B limit was not consumed on this continuation.

| Brief | A loop on | A loop off | B img2threejs | New quality/cost comparison |
| --- | --- | --- | --- | --- |
| Barrel | Blocked: 429, no recipe | Blocked: 429, no recipe | Blocked by same provider quota; no session | No score / unavailable |
| Hay bale | Blocked: 429, no recipe | Blocked: 429, no recipe | Blocked by same provider quota; no session | No score / unavailable |
| Round oak | Blocked: 429, no recipe | Blocked: 429, no recipe | Blocked by same provider quota; no session | No score / unavailable |

The six attempts are preserved under `tools/assetgen/runs-ebr83-85/` and
`runs-ebr83-85-off/`; `final.json` records rounds, time, status, and
`visual critique not run`. The first four attempts did not preserve the 429
stdout; the OpenCode server reported the quota error and the runner was fixed
to retain it. The oak attempts include the actual 429 events. No output token
cost is available for failed requests. The approach-B inputs, where prepared,
are A-derived rather than independent references and remain a bias even after
quota recovery. Without independent B models, comparable scores, and human
review, recommending a winner would be misleading.

For Look Dev's P0-only review, **historical** loop outputs (not new runs and
not shippable assets) were re-rendered with the merged EBR-80 lights:

| Historical candidate | New deterministic status | EBR-80 contact / 320×180 silhouette / scale composite |
| --- | --- | --- |
| Barrel | FAIL H1: old 12/16-segment geometry exceeds the new 6–8-segment vocabulary; further geometry checks not run | [Sheet](../evidence/assetgen/ebr83-85/historical/barrel/sheet.png) · [silhouette](../evidence/assetgen/ebr83-85/historical/barrel/silhouette-grass-045.png) · [composite](../evidence/assetgen/ebr83-85/historical/barrel/composite-daytime.png) |
| Hay bale | FAIL: old `bevelBox` is outside the PM vocabulary; a lower-trust custom conversion was used **only for display** | [Sheet](../evidence/assetgen/ebr83-85/historical/hay-bale/sheet.png) · [silhouette](../evidence/assetgen/ebr83-85/historical/hay-bale/silhouette-grass-045.png) · [composite](../evidence/assetgen/ebr83-85/historical/hay-bale/composite-daytime.png) |
| Round oak | Current hard and measured pixel checks clear; prior loop hit five rounds, and its visual critics disagreed, so it remains `needs-human` | [Sheet](../evidence/assetgen/ebr83-85/historical/round-oak/sheet.png) · [silhouette](../evidence/assetgen/ebr83-85/historical/round-oak/silhouette-grass-045.png) · [composite](../evidence/assetgen/ebr83-85/historical/round-oak/composite-daytime.png) |

On the fresh renders, minimum daytime changed-pixel counts are barrel 51,
hay 57 and oak 195; the numeric silhouette test is not semantic recognition.
Second oak, bush, three rocks and crate have not been generated. No bundle,
showcase or runtime registry entries were created. The previous bake-off and
its evidence are retained below for provenance, not reclassified as current.

## Historical pre-EBR-80 attempt

2026-11-06 · `feat/assetgen` · **No winner selected.** Jiaxu/Look Dev must
decide after EBR-80 lands and a comparable independent B result exists. All
current candidates are `needs-human`, not signed or registered.

## Method and limitations

Approach A is this worktree's closed-recipe loop. It uses the real game
renderer, 320×180 pixel pass, current (pre-EBR-80) lighting, 8 fixed yaws,
three light phases and grass/path/void backgrounds. Each stage runs hard
checks first, then browser measurements and a separate OpenCode critic session.
The generator and critic are the **same configured model**, so separate
sessions do not constitute independent art-direction approval. The critic
was able to answer three blinded colour-image probes, but that is not proof
of reliable recognition. All scores are preliminary.

The initial A runs exposed a subprocess-location bug: the child `cwd` changed
but inherited `PWD` still pointed to the worktree, so the intended tool-deny
policy did not apply. All three generation and critic transcripts were
audited: none contains a tool call. The bug was fixed and regression-tested;
the later re-critiques ran in isolated tool-denied scratch sessions.

Approach B was `img2threejs` npm installer 0.2.0 / skill 2.0.1, commit
`0c0c49bc168e648dbaf9c8c080474de0b3a941b6`, Apache-2.0. It was installed
outside the repo at `/tmp/assetgen-img2threejs.REij4K`; no tool code is
committed. Execution used OpenCode with direct shell/network access denied,
an offline network namespace and a read-only skill checkout. The installed
tool requires an input image; because external art was prohibited and none
was supplied, B's local barrel and hay references are renders of A's best
candidates. This is **not an independent or fair from-nothing comparison**.

The B time box included installation and sandbox setup. It began at 14:31:19
UTC and was stopped at approximately 15:02:50 UTC: about 31½ minutes, an
unintended ~1½-minute overrun. Barrel and hay sessions were interrupted;
oak was not started. Neither completed an official build or produced a model
or contact sheet. B's quality and palette fit therefore remain unmeasured.
Do not select a winner from this incomplete trial.

## Results

| Asset | A recipe result | A preliminary evidence | B img2threejs result |
| --- | --- | --- | --- |
| Barrel | 3 rounds, 0/6 stages completed; 400 tris, 3 palette colours; H1–H10 and measured pixel floors clear, but original critic rejected the hoops. Corrected-sheet re-critiques disagree on the lid. `needs-human`. | [Original critic sheet](../evidence/assetgen/barrel-recipe-sheet.png); [corrected verification sheet](../evidence/assetgen/barrel-verified-sheet.png); [report](../tools/assetgen/runs/barrel/final.json) | Interrupted during local-spec search. Input admission rejected the synthetic reference; the session nevertheless marked admission done. No B model or sheet. |
| Hay bale | 3 rounds, 0/6 stages completed; 76 tris, 3 palette colours; H1–H10 and measured pixel floors clear, but the original critic rejected readability. Corrected-sheet re-critiques disagree on bands/ends. `needs-human`. | [Original critic sheet](../evidence/assetgen/hay-bale-recipe-sheet.png); [corrected verification sheet](../evidence/assetgen/hay-bale-verified-sheet.png); [report](../tools/assetgen/runs/hay-bale/final.json) | Interrupted at reference admission. No B model or sheet. |
| Round oak | 5 rounds, 3/6 stages completed; best material-stage candidate has 88 tris, 4 palette colours and passes H1–H10 and measured pixel floors. Corrected-sheet re-critiques disagree on the foliage tiers. `needs-human`. | [Corrected verification sheet](../evidence/assetgen/round-oak-verified-sheet.png); [original critic sheet](../evidence/assetgen/round-oak-recipe-sheet.png); [report](../tools/assetgen/runs/round-oak/final.json) | Not started before B time box expired. |

For A, barrel's smallest measured daytime silhouette across fixed views and
backgrounds is 58 pixels; hay bale's is 59; oak's is 188. Those floors and a
palette-only material check do **not** prove the asset is recognisable.
Rendered palette-cluster distance remains unmeasured.
The corrected checker measures each tagged part individually: best-view
contributions were barrel hoops 11/18/13 pixels and lid 23, hay bands 11/11
and ends 23/22, oak foliage-tier parts 56/55. All exceed the two-pixel floor,
yet that does not establish that a viewer recognises three hoops or foliage
tiers as such.

The initial contact-sheet crop clipped the top of the tall oak. The crop was
fixed without moving the actual camera; the old sheets and their critiques
remain in the log, and the final candidates were independently re-critiqued
on corrected, SHA-256-recorded sheets. This exposed substantial model
instability: for barrel one re-critique accepted all features, another said
the lid was missing; for hay one rejected bands and ends, another accepted
both. The oak re-critiques likewise disagreed on foliage tiers. No vote or
high aggregate score overrides this uncertainty. See `postVerificationCritiqueHistory`
in each final report and the immutable `verify/critic-sheet-*.png` snapshots.
At equal scores the best-of selector now prefers the later equally clean stage;
oak was transparently reselected from blockout to its material-stage candidate.
The barrel was scored before the later cap on critic-blocked candidates;
its numeric score is historical and is **not comparable** with the other two.
The review-only [`bakeoff-manifest.json`](../tools/assetgen/bakeoff-manifest.json)
contains the three candidate hashes and `needs-human` statuses; the runtime
registry remains empty.

## Time and model usage

Numbers below are OpenCode session API totals, not price estimates. API-reported
cost was `$0` for each session; this is not a guarantee of actual billing.
Wall time includes model waits and browser rendering; runs overlapped, so do
not add them to obtain elapsed project time.

| Asset / approach | Wall time | Input / output tokens | API-reported cost |
| --- | ---: | ---: | ---: |
| A barrel | 3m 15s + 33s and 37s re-critiques | 165,772 / 2,142 | $0 |
| A hay bale | 7m 01s + 23s and 50s re-critiques | 104,263 / 1,937 | $0 |
| A round oak | 11m 10s + 28s and 59s re-critiques | 279,373 / 3,486 | $0 |
| B barrel | 5m 05s, interrupted | 3,541,382 / 3,537 | $0 |
| B hay bale | 1m 26s, interrupted | 564,463 / 1,919 | $0 |
| B round oak | not started | unavailable | unavailable |

The B barrel's local search tried to create a cache inside the protected
read-only tool checkout and failed. This sandbox restriction is fixable in a
future, separately authorised retry by binding a writable cache directory;
the rejected input image also needs an independently sourced, segmentable
reference. No workaround was used after the time box. Sanitised call traces,
state and the two A-derived references are in
[`evidence/assetgen/img2threejs/`](../evidence/assetgen/img2threejs/); full
upstream code and raw tool-response transcripts are not copied into the repo.

## Checker acceptance still open

The negative fixtures exercise H1, H2, H3, H4, H5, H7, H8, H9, H10,
non-finite values, a hidden identity feature and a reversed existing key light
(S4). A browser test actually renders the latter two. Determinism H6 has a
separate negative test. The exact signed tree, coop, fence and stair tread
remain finite, nondegenerate and within their budgets, but cannot honestly
all pass the new strict rules: old fence/coop details violate the 0.3-unit
readable-face floor; the tree has a transparent contact shadow; the tree and
coop contain near-coplanar contact pairs (not necessarily visible z-fighting);
and the tread uses interpolated colours. See
[`signed-fixtures.json`](../evidence/assetgen/signed-fixtures.json). These
are signed legacy references, not automatic exemptions for new recipes;
QA and Look Dev must decide how to reconcile the golden-fixture requirement.
S1 rendered palette distance, S3 three-step values, S5 night glow and S7 style
distance are unmeasured. Lighting-stage advancement is blocked on missing S3/S5.
