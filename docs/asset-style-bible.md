# Asset Forge style bible

**Draft for Look Dev and QA.** The authority is Look Dev's 2026-11-06
`ASSET-BRIEF.md`; PM's recipe, four-round and no-animal rulings take precedence
for this PR. Its numbers are design values, not
measurements from the Daniil frames. The machine-readable block below is the
shared generator/checker contract; changes require a fresh verification run.
EBR-80 is merged: fresh renders use the actual game lighting, but remain
preliminary until Look Dev signs them. Earlier saved renders predate EBR-80.

## Shape, scale and materials

The farm is a warm, cozy, chunky toy diorama: slightly rounded masses, a few
broad flat-shaded facets, deliberate small irregularities and no random noise.
Prioritise the silhouette and 3–5 identity features over decoration. At
1280×720 the game renders the world at 320×180 then enlarges it to 4 CSS pixels
per world pixel: 1 unit = 9 render pixels; 0.11 is ~1 pixel, 0.2 ~2 pixels,
and 0.3 ~2.7 pixels. Nothing, including cleats and bands, may be thinner than
0.1 units. Readable parts should be at least 0.2 units thick; handles, wheels,
windows and hats need at least two dimensions of 0.3. Rails/planks may be 0.1
thick if their other cross-section dimension is at least 0.13. Do not
put hairline grain, text, tiny nails, separate leaves, textures or bitmap art on
assets. Use opaque flat-shaded matte materials (roughness 1, metalness 0);
water/glass may be 0.25–0.7. Use 3–6 major masses, 6–8 segments for round
parts, and 1–2 geometric wear cues. No new lights, baked lighting, fake
outlines, textures, transparency, gradients, noise or shadow maps.
Use at most three albedo tones per material family; never bake a light direction
into those colours. Ground contact shadows are supplied by the game.

Reference scales from actual code: character capsule 1.4 high, radius 0.4;
placement tile 1.5; existing fence 1.47×0.17×0.95; cottage walls 4.4×3×2,
chimney top 3.6; coop body 1.4×1.3×1.1 with a raised floor and ramp; signed
tree approximately 2.8 high. Expected heights: bucket 0.4, barrel 1.0,
crate 0.7, hay 0.6, trough 0.5, bench 0.8, wheelbarrow 0.7, well 1.6,
scarecrow 1.8, lantern 1.8, mailbox 1.2, sign 1.3, flower patch 0.3, rock
0.3–0.8, bush 0.7, oak 2.6–3.6 and pine 3–4.2.

Every recipe has a base-centred origin at (0,0,0), +Y up, and front +Z. Its
declared footprint and height must agree within 10% with both the spec and the
built bounds. Nothing may sit below -0.01; every part must connect to the
ground or another connected part. Face direction is a semantic claim: numerical
checks cannot prove a door or handle actually faces +Z.

## Closed recipe vocabulary

The runtime source of truth is declarative JSON: a named part, primitive,
dimensions, transform, palette token and identity-feature tag. No arbitrary
code, external assets, URLs, textures, or raw colour hexes in recipes. Allowed
primitives: `box`, `cylinder`, `cone`, `sphere` (faceted
icosahedron detail 0–1), `capsule`, `wedge`, `lathe` and `extrude`. A bounded
`custom` BufferGeometry array is an explicit lower-trust escape hatch, never
an exemption from checks or human review. At most 40 parts; no nonuniform
transform scale above 1:3. Optional jitter must specify a seed and stay within
0.03 units/radians. Use enough separation or overlap to avoid coplanar faces;
an explicitly declared polygon offset is recorded and subject to review.

Allowed albedo tokens are defined in `src/assets/palette.ts` using the exact
game constants from `src/scene/farmPalette.ts` and
`src/scene/farmBuildingMaterials.ts`. They include `foliage.mid/light/dark`,
`trunk`, `wood.light/mid/dark`, `timber`, `door`, `dirt`, `dirt.edge`,
`dirt.hi`, `plaster`, `roof`, `roof.band`, `stone`, `glass` and
`water`, `water.rim`, `water.deep`. They can be resolved through named slots
for later retinting. Look Dev explicitly approves `flower.red`, `flower.yellow`,
`flower.blue`, `flower.orange`, `pumpkin`, `metal`, and `lantern.glow`; use
each only for its stated purpose in `ASSET-BRIEF.md`. `wool` is approved in
the brief but **out of scope in this PR**, along with animals (EBR-70).
All other extensions require written approval. Normally use one flower accent
per patch; a second is optional. No pure black/white, magenta, purple, neon,
chrome, metallic sheen or unrelated saturated blue/cyan. Only lantern-post
glass may declare `lantern.glow`, night-ramped, without a PointLight.

Signed references to retrieve: `src/scene/createFarmLayout.ts` (trees),
`src/scene/createCottage.ts`, `src/scene/createRampCoop.ts`,
`src/placement/createPlacementVisual.ts` (fence), and
`src/scene/createStoneStairs.ts`. Existing signed assets predate this contract:
some contain translucent ground shadows, prelit/interpolated stair colours,
polygon offset, and small details. Do not silently reinterpret those as allowed
recipe colours or as evidence that a new recipe passed a rule.

## Stages, checks and review

Run blockout, form, palette/material, detail, in-scene lighting and optimisation
in that order. Every stage requires H1–H10 before fixed-camera render feedback
and an independent OpenCode critic. A rendered identity feature that cannot be
seen is a blocker even if the overall score is high. A pixel-difference test can
measure the visible contribution of each tagged part (not just the combined
feature), but **cannot prove that a
tag is truthful**; the vision critic and human must judge semantic identity.
Fixed renders use eight 45-degree yaws, three game light phases and grass,
path and void backgrounds. Each frame has a hash; QA also requires morning and
night-rain assessment and in-game placement before final signoff. The generator
and critic receive the full REJECT rubric and the signed cottage/coop/fence/tree/
stairs anchors. Anti-examples are a smooth sphere tree, spiky rock and
off-palette barrel; numeric heuristics cannot replace Look Dev's eye.

| Hard gate | Meaning |
| --- | --- |
| H1 | Closed schema, allowed primitives and palette tokens. |
| H2 | Part and triangle budgets. |
| H3 | Bounds and metadata within 10% of the brief. |
| H4 | Base-centred origin (centre offset ≤15% of footprint), ground contact and declared +Z front. |
| H5 | Minimum 0.1 thickness everywhere, 0.2 readable parts, 0.3 handle/wheel/window/hat faces. |
| H6 | Two builds have identical geometry/material hashes. |
| H7 | Detect near-coplanar overlap; signed references can have analytic warnings, and empirical flicker is a failure. |
| H8 | All parts connected to each other or ground. |
| H9 | Nothing below -0.01 for new assets. |
| H10 | Collision footprint area and each box axis are 90–130% of declared dimensions. |

Soft checks include at least 40 changed pixels per silhouette at game scale;
contrast against grass/path/void of at least 1.15 luminance ratio or CIE76 ΔE
of 25. Day, morning and sunset checks are hard. At night, the 40-pixel grass
floor remains hard; path/void size and all contrast are advisory. The exact
signed fence is a documented legacy warning, not an exception for new recipes.
Other soft checks cover key-light/three-step value agreement, night glow, scene
scale and style distance. These are design floors, not measurements or
proof of quality. The vision critic's separate session scores silhouette,
palette, shape language, value structure, scene fit and craft 1–5 and names
blockers/fixes. If image reading or critique fails, the report must say
**visual critique not run**; a numeric-only check is not a visual pass.

At most four candidate rounds, with bounded corrections per stage and globally.
Record `continue`, `refine-spec`, `refine-code`, `request-input` or `stop`,
source/recipe, checks, renders, critique and the best-so-far candidate. The
candidate reaching the cap remains `needs-human`, is listed separately with
its renders, and cannot enter the bundle. Only `PASSED` candidates may be
bundled, and actual in-game assets still require Look Dev signoff. An independent
critic session is not independent artistic approval.

## Priorities and automatic rejection

P0 calibration only: two distinct round oaks, bush, three rocks, barrel, crate
and hay bale. P1 includes pine/fir, grass tufts, flowers, stump, fallen log,
fence, trough, wheelbarrow, lantern and sign. P2 has bucket, axe/stump,
mushrooms, pumpkins, well, scarecrow, bench and mailbox. Optional P3 includes
stepping stones, a flower box and small beehives. This PR creates the tool and
bake-off, **not** the P0 bundle, showcase, animals, wool, new buildings or
runtime registry entries. Look Dev reviews P0 alone before further generation.

Reject off-palette/forbidden hues; wrong art style; sub-pixel detail or an
unreadable silhouette; smooth/plastic/spiky/realistic forms; floating, buried
or mistaken overlaps; failed budgets or gates; shading against the upper-left
key; baked outlines, text, decals or textures; wrong scale; and recolour-only
variants. No eggs, inventory objects, people, modern vehicles, new water,
PointLights or fences different from the signed placement fence. The critic
must name the specific failed part and never override a deterministic blocker.

```assetgen-rules
{
  "version": 3,
  "triBudgets": { "prop": 600, "flora": 900, "building": 2500, "terrain": 1200 },
  "maxParts": 40,
  "maxColors": 8,
  "paletteDistanceRGB": 3,
  "dimensionToleranceRelative": 0.10,
  "baseTolerance": 0.02,
  "belowGroundTolerance": 0.01,
  "centerToleranceRelative": 0.15,
  "centerToleranceAbsolute": 0.02,
  "minimumFeature": 0.10,
  "minimumReadableThickness": 0.20,
  "minimumReadableFace": 0.30,
  "exceptionMinimumFeature": 0.10,
  "maxScaleRatio": 3,
  "jitterMaximum": 0.03,
  "degenerateArea": 0.00000001,
  "zFightPlaneDistance": 0.005,
  "zFightNormalDot": 0.9999,
  "zFightOverlapArea": 0.000005,
  "contactTolerance": 0.005,
  "collisionMinRatio": 0.90,
  "collisionMaxRatio": 1.30,
  "render": { "width": 1280, "height": 720, "pixelSize": 4, "yaws": [0, 45, 90, 135, 180, 225, 270, 315], "phases": ["daytime", "sunset", "night"], "extraPhases": ["morning", "night-rain"], "surfaces": ["grass", "path", "void"], "minimumSilhouettePixels": 40, "minimumContrastRatio": 1.15, "minimumDeltaE": 25, "pixelDeltaRGB": 8, "identityMinimumPixels": 2 },
  "loop": { "maxRounds": 4, "maxCorrectionsPerStage": 2, "maxCorrectionsGlobal": 3, "stages": ["blockout", "form", "material", "detail", "lighting", "optimise"] }
}
```
