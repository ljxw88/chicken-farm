# Asset Forge: bake-off prototype

`docs/asset-style-bible.md` is the generator/checker contract. The source of
truth is a closed-vocabulary JSON recipe built by `src/assets/buildRecipe.ts`,
not generated TypeScript. Specs contain 3–5 identity features. The builder
resolves palette slots, adds no lights, and can flag custom BufferGeometry or
polygon offset as lower-trust. The registry is intentionally empty: the three
bake-off candidates are **not** signed, bundled, or placed in the game.

## Image capability test

On 2026-11-06 the installed `~/.opencode/bin/opencode` correctly answered three
shuffled, blinded dominant-colour PNG probes (BLUE, GREEN, RED), each in a new
session. Images, answers and transcripts are in
`evidence/assetgen/vision-probe/`. This establishes that image reading worked
for these probes; it does not prove reliable artistic judgment. Rerun with
`node tools/assetgen/probe-vision.mjs`. If it fails or is missing, the forge
reports **visual critique not run** and never claims a visual pass.

## How a candidate is built

```sh
npm run asset:new -- tools/assetgen/specs/barrel.json
npm run asset:verify -- barrel
```

OpenCode's default configured model writes JSON only, in a separate locked-down
scratch session where tool use is denied. The prompt includes this bible, the
recipe cheat sheet, 2–3 signed source references and prior feedback. Stages:
blockout → form → material → detail → lighting → optimise. Each stage first
runs deterministic H1–H10 checks, then 8 fixed yaws × 3 phases × 3 backgrounds
using the real game renderer and a separate OpenCode visual-critic session.
Identity tags must exist and each tagged part must have a measured visible
pixel contribution in at least one fixed view; the critic must also judge
whether the part genuinely depicts the feature.

The first three bake-off runs were started before a subprocess `PWD` bug was
fixed: their sessions ran in the worktree rather than the intended scratch
location. Their JSONL transcripts contain **no tool calls**; the generator was
instructed to return data only. The subsequent re-critiques used the corrected
scratch policy. A regression test now checks that both `cwd` and `PWD` match.

Up to five rounds are allowed, with at most two corrections per stage and five
globally. Every decision and best-so-far candidate is recorded. Even a candidate
with all internal gates clear remains `needs-human`, `signedBy: null` and is not
in the runtime registry. `npm run asset:bundle` deliberately refuses to ship
before EBR-80 and Look Dev review. A failed OpenCode call is retried with its
error; exhausting generation retries writes a Herdr work order. `--work-order`
emits it immediately without requiring Chromium or an OpenCode connection.

The render pack and SHA-256 frame manifest, contact sheet, recipe, hard-check
report, prompts and separate model transcripts live under
`runs/<id>/round-N/stage-<name>/`. The best candidate and final report are in
`runs/<id>/best.json` and `final.json`. Token usage/cost is read from OpenCode's
session API when available; unknown cost is not estimated from text length.

## Important limits

* Current lighting is the pre-EBR-80 game lighting. No view here is final
  Look Dev approval; a gallery/showcase is deferred until EBR-80 lands.
* H8 uses triangle/contact and closed-mesh containment checks, but arbitrary
  malformed custom meshes and near-tangencies still merit human inspection.
* H4 checks declared facing and centred bounds, not whether a semantic door
  truly faces +Z. Identity visibility measures a pixel contribution, not the
  truth of a label. The visual critic is not independent artistic approval.
* S1 rendered palette-cluster distance, S3 three-step value, S5 night glow and
  S7 style distance are explicitly **unmeasured**, not passing checks. S4 is a
  preliminary normal/albedo-normalised key-light estimate under old lighting.
  The loop stops for input at its lighting stage rather than advancing on
  missing S3/S5 evidence.
* Exact signed scene fixtures are regression-tested for finite, nondegenerate,
  budgeted geometry using the same overlap/contact routines. They are not all
  strict H1–H10 goldens: the old fence and coop contain sub-0.3 readable pieces,
  the tree has a transparent contact shadow, the tree/coop have coplanar
  shadow/post joins (not necessarily visible z-fighting), and the stair tread
  derives interpolated colours. QA/Look Dev must resolve these legacy
  exceptions; new
  recipes do not inherit them. This is an open checker-acceptance gate.
* Neural Meshy/Tripo/Hunyuan3D/TRELLIS workflows are parked and not used.
