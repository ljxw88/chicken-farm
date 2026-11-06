# Asset Forge style bible

**Draft for Look Dev and QA.** Aligned with Look Dev's 2026-11-06
`ASSET-FORGE-LOOKDEV.md`, read in full. Its numbers are design values, not
measurements from the Daniil frames. The machine-readable block below is the
shared generator/checker contract; changes require a fresh verification run.
The EBR-80 lighting change has not landed in this worktree. All current renders
use the existing game lighting and are **preliminary**, not Look Dev signoff.

## Shape, scale and materials

The farm is a warm, cozy, chunky toy diorama: slightly rounded masses, a few
broad flat-shaded facets, deliberate small irregularities and no random noise.
Prioritise the silhouette and 3–5 identity features over decoration. At
1280×720 the game renders the world at 320×180 then enlarges it to 4 CSS pixels
per world pixel. Use parts at least 0.1 units thick, normally with a readable
0.3×0.3 face; only explicitly labelled cleats or bands may be thinner. Do not
put hairline grain, text, tiny nails, separate leaves, textures or bitmap art on
assets. Use opaque flat-shaded matte materials (roughness 1, metalness 0);
water/glass may be 0.25–0.7. No new lights, baked lighting or shadow maps.

Reference scales from actual code: character capsule 1.4 high, radius 0.4;
placement tile 1.5; existing fence 1.47×0.17×0.95; cottage walls 4.4×3×2,
chimney top 3.6; coop body 1.4×1.3×1.1 with a raised floor and ramp; signed
tree approximately 2.8 high. Look Dev's 3–4-unit tree guidance is a design
target for *new* trees, not a measurement of the existing tree.

Every recipe has a base-centred origin at (0,0,0), +Y up, and front +Z. Its
declared footprint and height must agree within 10% with both the spec and the
built bounds. Nothing may sit below -0.02; every part must connect to the
ground or another connected part. Face direction is a semantic claim: numerical
checks cannot prove a door or handle actually faces +Z.

## Closed recipe vocabulary

The runtime source of truth is declarative JSON: a named part, primitive,
dimensions, transform, palette token and identity-feature tag. No arbitrary
code, external assets, URLs, textures, or raw colour hexes in recipes. Allowed
primitives: `box`, `bevelBox`, `cylinder`, `cone`, `sphere` (faceted
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
for later retinting. The separate `legacy` tokens reproduce existing signed
decorations, not a general permission to invent colours. Look Dev's named
accent list is an explicit extension: at most one accent per asset; its source
and reason must be recorded in the palette module. Unapproved `proposedTokens`
must not build. No pure black, pure white or neon palette additions.

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
measure the visible contribution of tagged parts, but **cannot prove that a
tag is truthful**; the vision critic and human must judge semantic identity.
Fixed renders use eight 45-degree yaws, three game light phases and grass,
path and void backgrounds. Each frame has a hash. EBR-80 must be integrated
before interpreting lighting direction, night appearance or style fit as final.

| Hard gate | Meaning |
| --- | --- |
| H1 | Closed schema, allowed primitives and palette tokens. |
| H2 | Part and triangle budgets. |
| H3 | Bounds and metadata within 10% of the brief. |
| H4 | Base-centred origin, ground contact and declared +Z front. |
| H5 | Minimum feature thickness/readable face, with explicit band/cleat exceptions. |
| H6 | Two builds have identical geometry/material hashes. |
| H7 | No overlapping near-coplanar faces within 0.005, except declared polygon offset. |
| H8 | All parts connected to each other or ground. |
| H9 | Nothing below -0.02. |
| H10 | Collision footprint is 90–130% of the declared footprint. |

Soft checks include at least 40 changed pixels per silhouette at game scale;
contrast against grass/path/void of at least 1.15 luminance ratio or a
meaningful hue difference; key-light/three-step value agreement, night glow,
scene scale and style distance. These are design floors, not measurements or
proof of quality. The vision critic's separate session scores silhouette,
palette, shape language, value structure, scene fit and craft 1–5 and names
blockers/fixes. If image reading or critique fails, the report must say
**visual critique not run**; a numeric-only check is not a visual pass.

At most five candidate rounds, with bounded corrections per stage and globally.
Record `continue`, `refine-spec`, `refine-code`, `request-input` or `stop`,
source/recipe, checks, renders, critique and the best-so-far candidate. The
best candidate remains `needs-human`; it is never a signed pass or a game
asset until Look Dev signs it after EBR-80. An independent critic is not
independent artistic approval.

```assetgen-rules
{
  "version": 2,
  "triBudgets": { "prop": 600, "flora": 900, "animal": 800, "building": 2500, "terrain": 1200 },
  "maxParts": 40,
  "maxColors": 8,
  "paletteDistanceRGB": 3,
  "dimensionToleranceRelative": 0.10,
  "baseTolerance": 0.02,
  "centerToleranceRelative": 0.10,
  "centerToleranceAbsolute": 0.02,
  "minimumFeature": 0.10,
  "minimumReadableFace": 0.30,
  "exceptionMinimumFeature": 0.04,
  "maxScaleRatio": 3,
  "jitterMaximum": 0.03,
  "degenerateArea": 0.00000001,
  "zFightPlaneDistance": 0.005,
  "zFightNormalDot": 0.9999,
  "zFightOverlapArea": 0.000005,
  "contactTolerance": 0.005,
  "collisionMinRatio": 0.90,
  "collisionMaxRatio": 1.30,
  "render": { "width": 1280, "height": 720, "pixelSize": 4, "yaws": [0, 45, 90, 135, 180, 225, 270, 315], "phases": ["daytime", "sunset", "night"], "surfaces": ["grass", "path", "void"], "minimumSilhouettePixels": 40, "minimumContrastRatio": 1.15, "minimumHueDifferenceDegrees": 25, "pixelDeltaRGB": 8, "identityMinimumPixels": 2 },
  "loop": { "maxRounds": 5, "maxCorrectionsPerStage": 2, "maxCorrectionsGlobal": 5, "stages": ["blockout", "form", "material", "detail", "lighting", "optimise"] }
}
```
