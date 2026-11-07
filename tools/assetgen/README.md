# Asset Forge: bake-off prototype

`docs/asset-style-bible.md`, aligned to Look Dev's `ASSET-BRIEF.md`, is the
generator/checker contract. The source of
truth is a closed-vocabulary JSON recipe built by `src/assets/buildRecipe.ts`,
not generated TypeScript. Specs contain 3–5 identity features. The builder
resolves palette slots, adds no lights, and can flag custom BufferGeometry or
polygon offset as lower-trust. The registry is intentionally empty: the three
bake-off candidates are **not** signed, bundled, or placed in the game.

## Image capability test

The pre-EBR-80 probe passed three blinded dominant-colour PNGs. Historical
images and transcripts are in the external `pr21-tracked/evidence/assetgen/`
archive. `tools/assetgen/golden/vision-probe.json` is the retained capability
input; a fresh probe writes under `ASSETGEN_EVIDENCE_DIR` and takes precedence.
On 2026-11-06, `opencode/crouton-alpha-free` answered all three correctly.
Rerun it through the host heavy wrapper. A colour probe does not prove reliable
artistic judgment. If it fails, is disabled, or is missing, the forge
reports **visual critique not run** and never claims a visual pass.

## How a candidate is built

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy npm run asset:new -- tools/assetgen/specs/barrel.json
/home/michael/OpenBot/Shared/farm-tools/heavy npm run asset:verify -- barrel
```

OpenCode's default configured model writes JSON only, in a separate locked-down
scratch session where tool use is denied. The prompt includes this bible, the
recipe cheat sheet, 2–3 signed source references and prior feedback. Stages:
blockout → form → material → detail → lighting → optimise. Each stage first
runs deterministic H1–H10 checks, then 8 fixed yaws × 3 phases × 3 backgrounds
plus morning and night-rain, using the real game renderer and a separate
OpenCode visual-critic session.
Identity tags must exist and each tagged part must have a measured visible
pixel contribution in at least one fixed view; the critic must also judge
whether the part genuinely depicts the feature.

For schema-valid, axis-aligned recipes without jitter, a modest (at most 25%)
geometry size error can be fitted to the spec about the origin. Declarations
are never changed. The original model recipe and fit factors are recorded, and
the bundle audit replays the fit against the model receipt. All hard checks run
on the fitted recipe, including scaled profile-edge thickness. Larger errors,
bad metadata, rotations and jitter receive explicit measured per-part bounds
in the correction prompt instead; they are not silently fitted.

The first three bake-off runs were started before a subprocess `PWD` bug was
fixed: their sessions ran in the worktree rather than the intended scratch
location. Their JSONL transcripts contain **no tool calls**; the generator was
instructed to return data only. The subsequent re-critiques used the corrected
scratch policy. A regression test now checks that both `cwd` and `PWD` match.

Up to four rounds are allowed, with at most two corrections per stage and three
globally. Every decision and best-so-far candidate is recorded. A candidate
reaching the cap is `needs-human` and must not ship. Earlier automated `PASSED`
results still need Look Dev signoff before game integration. This PR creates no
runtime entries. A failed OpenCode call is retried with its
error; exhausting generation retries writes a Herdr work order. `--work-order`
emits it immediately without requiring Chromium or an OpenCode connection.

The render pack, report and transcripts go outside the repository, under
`/home/michael/OpenBot/Shared/farm-evidence/EBR-85/<head>/runs/` by default.
`ASSETGEN_EVIDENCE_DIR` and `ASSETGEN_RUN_DIR` select alternate locations. The
old runs and all review outputs are archived at
`/home/michael/OpenBot/Shared/farm-evidence/EBR-85/pr21-tracked/`; set
`ASSETGEN_ARCHIVE_DIR` if the archive is elsewhere. Only the three historical
recipes and three img2threejs input PNGs needed by the tools remain under
`tools/assetgen/golden/`; they are not approved runtime assets. Token usage/cost
is session-reported when available; unknown cost is not estimated.

## Recipe and external QA fixture schema

Specs are JSON objects with kebab-case `id`, `category` (`prop`, `flora`,
`terrain`, or `building` for signed fixtures only), a one-paragraph `brief`,
`size: {width, depth, height}`, `paletteHints`, `referenceAssetIds`, and
3–5 `identityFeatures: [{id, description}]`. An optional `variantOf` names
another fixture or previous recipe; an unchanged/recoloured or uniformly
rescaled silhouette is rejected. New buildings and animals are not generated.

A recipe is data only:

```json
{
  "id": "sample", "category": "prop",
  "footprint": {"w": 1, "d": 1}, "height": 1,
  "origin": "base-center", "facing": "+Z",
  "parts": [{"name":"body", "prim":"box", "size":[1,1,1],
    "at":[0,0.5,0], "mat":"wood.mid", "feature":"body"}],
  "anchors": {}, "emissive": [],
  "collision": {"type":"box", "w":1, "d":1, "h":1},
  "slots": {}, "tags": ["farm"]
}
```

This is a shape example, not a complete 3-feature QA fixture. Each part has a
unique kebab-case `name`, token `mat`, position `at:[x,y,z]`, optional Euler
`rot` in degrees, positive `scale`, identity `feature`, seeded `jitter`, and
optional `exception: "band"|"cleat"|"twine"` (still ≥0.1). Primitive fields:
`box`/`wedge` use `size:[w,h,d]`; `cylinder` has `radiusTop`, `radiusBottom`,
`h`, `segments`; `cone` has `radius`, `h`, `segments`; `sphere` has `radius`,
`detail:0|1`; `capsule` has `radius`, `length`, `segments`; `lathe` has
`profile:[[radius,y],...]`, `segments`; `extrude` has `polygon:[[x,y],...]`,
`depth`. Round segment counts are 6–8. The `custom` escape hatch takes finite
`positions` and triangle `indices` and is explicitly lower trust. No raw hex,
code, lights, textures, transparency or vertex colours. `slots` map aliases to
approved palette tokens. Only the lantern-post glass can declare
`emissive:[{part,mat:"lantern.glow",strength}]`; it adds no light. See
`recipe-cheatsheet.md` and `docs/asset-style-bible.md` for the exact contract.

QA may supply an external folder without giving the verifier write access to
it. Each subdirectory is `<id>/spec.json` plus `<id>/recipe.json`; alternatively
use `<id>.spec.json` and `<id>.recipe.json`, or `<id>.fixture.json` containing
`{"spec":{...},"recipe":{...}}`. A signed reference fixture can be
`<id>.fixture.json` containing only `{"signed":"tree"}` (or `coop`, `fence`,
`tread`). The tool prints each named reason and writes render evidence to a
fresh temporary directory, never into the QA folder. Use either:

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy npm run asset:verify -- --dir /absolute/path/to/fixtures
/home/michael/OpenBot/Shared/farm-tools/heavy npm run asset:verify -- --dir /absolute/path/to/fixtures --id fixture-id
/home/michael/OpenBot/Shared/farm-tools/heavy npm run asset:verify -- --signed all
```

A9's daytime/morning/sunset floors are the unrounded per-phase minima measured
with the same renderer and A9 calculation on the signed coop, fence and tread.
`tools/assetgen/a9-calibration.json` records the measurements and signed hashes;
the report prints the active table. If those assets or the measurement inputs
change, verification remeasures all three in memory. To explicitly refresh the
checked-in table and its digest after a reviewed reference change, run:

```sh
/home/michael/OpenBot/Shared/farm-tools/heavy npm run asset:verify -- --calibrate
```

Tree-class flora (an `oak`, `pine`, `fir` or `tree` id token, or a spec
`assetClass: "tree"`) has no numeric A9 floor and needs by-eye review; other
flora still use the calibrated floors. The separate key-direction S4 check is
not waived. S2 remains hard against grass/path/void by day, morning and sunset.
At night and night-rain the same pixel floor remains hard on grass; path/void
area and contrast are warnings. Only the fingerprinted signed placement fence
has a legacy S2 warning for its narrow end-on silhouette; new recipes do not.

Verification makes no model calls. `asset:bundle` rechecks exact source-file bytes,
spec, bible and verifier hashes and reruns offline checks; it refuses any
`needs-human`, stale or forged result and never changes the runtime registry.
It also requires a separate Look Dev signoff containing the exact recipe,
spec, bible, verifier and `reportHash` hashes and refuses
promotion while required visual checks are unmeasured. The signoff file is not
a cryptographic identity system; protect it as a review artifact. Generator and
critic JSONL receipts must match their recorded hashes, session IDs, recipe and
critique. Loop-off
comparisons use `--loop-off` (one generation only) with a
separate `ASSETGEN_RUN_DIR`; their outputs cannot be used as approvals.

## Important limits

* Fresh renders use the merged EBR-80 lighting. No view here is final Look Dev
  approval; a gallery/showcase and bundle generation are deferred to EBR-86.
* H8 uses triangle/contact and closed-mesh containment checks, but arbitrary
  malformed custom meshes and near-tangencies still merit human inspection.
* H4 checks declared facing and centred bounds, not whether a semantic door
  truly faces +Z. Identity visibility measures a pixel contribution, not the
  truth of a label. The visual critic is not independent artistic approval.
* S1 rendered palette-cluster distance, S3 three-step value, S5 unlit-face glow
  beyond material/highlight checks, and S7 style distance are explicitly
  **unmeasured**, not passing checks. S4 is a preliminary normal/albedo-normalised
  key-light estimate under merged EBR-80 lighting, not the full QA G2 method.
  The loop stops for input at its lighting stage rather than advancing on
  missing S3/S5 evidence.
* Exact signed tree/coop/fence/tread fixtures have a fingerprinted real-game
  audit path. Known legacy colours, contact shadows, small details and analytic
  coplanar ties are reported as warnings only for those exact fingerprints;
  new recipes do not inherit the exceptions. A 24-yaw 0.001-unit jitter test
  samples interior pixels and records excluded antialiased silhouette edges;
  it does **not** prove those excluded edges cannot flicker. Placement, walking
  shimmer and independent Look Dev signoff remain EBR-86 checks.
* Neural Meshy/Tripo/Hunyuan3D/TRELLIS workflows are parked and not used.
