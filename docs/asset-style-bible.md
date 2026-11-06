# Farm asset style bible

Status: proposed for Look Dev review; the existing game art remains the authority.
This document is also the generator/verifier contract. The JSON block below is
machine-readable; change it deliberately, then re-verify the whole bundle.

## Read the scene before designing

The game is a cozy, chunky, low-poly farm diorama, not a realistic model viewer.
Its orthographic camera looks from `(12, 12, 12)` with a 20-unit vertical view.
At 1280×720 the actual world is rendered at 320×180 and enlarged in 4-CSS-pixel
blocks. Judge the silhouette at that size, not just in a zoomed render. Model
big, recognisable masses first; use at most two or three useful tones per
material family. Prefer slightly exaggerated features to fine surface detail.
Avoid details thinner than about 0.05 world units; most important features need
to be considerably larger to survive the game camera. No textures, text,
external models, downloads, procedural noise, photo realism or gradients.

The island top is y=2.4 in the game, but an asset's local origin is **base
centre at (0,0,0)**, +Y up, recognisable front toward +Z. A placement system
will translate the group to the ground. Do not bury geometry below y=-0.01.
Centre the *bounds* on X and Z, including handles, wheels and protrusions.
Size metadata describes the visible bounds, not an empty collision envelope.

## Scale and references

* Character: roughly 1 unit tall.
* Existing placement fence: 1.47 wide, 0.95 high; posts 0.17 square.
* Cottage: 4.4 × 3.0 wall footprint, 3.6 high including chimney.
* Raised coop: 1.4 × 1.3 body, approximately 1.95 high including roof; ramp
  extends forward 1.1. Existing tree: roughly 2.8 high.
* `src/scene/createFarmLayout.ts`, `createCottage.ts`, `createRampCoop.ts`,
  `src/placement/createPlacementVisual.ts`, and `createFarmDecorations.ts`
  provide the signed silhouettes. The last also contains older, non-palette
  detail colours: use it for shape only, not as permission for extra colours.

## Allowed albedo colours

Use named keys from `FARM_PALETTE` in `src/scene/farmPalette.ts` or
`BUILDING_PALETTE` in `src/scene/farmBuildingMaterials.ts`. Despite the
building dimensions living in `farmBuildingSpecs.ts`, the building colours
are in the materials module. The verifier imports those exact constants; this
list is explanatory and does not replace them. Duplicate values count once.

| Family | Keys / sRGB hex |
| --- | --- |
| Grass/foliage | farm.grass `5fa846`, farm.treeFoliageDark `3d7a3a`, farm.treeFoliage `5fa846`, farm.treeFoliageLight `7cbc5a` |
| Soil/wood | farm.dirt `a67c52`, farm.dirtEdge `7a5a3a`, farm.dirtHighlight `c4a06a`, farm.barnWood `d4a574`, farm.barnTrim `8b6914`, farm.barnDoor `6b4423`, farm.treeTrunk `6b4a2e` |
| Roof/glass/water | farm.barnRoof `c45a3a`, farm.barnWindow `8aa0a8`, farm.pondWater `5b8fa8`, farm.pondRim `7aadb8`, farm.pondDepth `3a6a7a` |
| Cottage/coop | building.plaster `efe3c8`, building.timber `8b5e3c`, building.door `6b4423`, building.cottageRoof `c45a3a`, building.shingle `a94a30`, building.stone `9a8a78`, building.glass `8aa0a8`, building.coopWall `c8956c`, building.posts `6b4423`, building.ramp `a67c52`, building.cleats `7a5a3a`, building.popHole `3e2a1a` |

Do not introduce hex literals, interpolated tints, custom lighting or emissive
colours. A genuinely missing colour needs a **named palette extension and a
written reason**, followed by Look Dev review; none is approved by this bible.
Use flat-shaded `MeshStandardMaterial`, opaque surfaces, and palette albedo;
the game's existing lights provide shading. No lights or shadow maps in assets.
Do not fake outlines, cast shadows, alpha cards, labels or billboard sprites.

## Geometry and naming

Each `src/assets/<category>/<id>.ts` is a self-contained procedural Three.js
module exporting `meta` and `build(): THREE.Group`. IDs and filenames are
lowercase kebab-case, globally unique, and match their spec. `meta` contains
id, category, footprint `{ width, depth }`, height, `palette` (qualified keys
such as `farm.barnWood`), and `triBudget`. All dimensions are in world units.
Only primitives, extrusions or custom BufferGeometry; no dynamic fetches or
asset imports. Keep nodes and materials simple and deterministic.

Use silhouettes that are legible from the front, side and game-camera three
quarter view. Overlap solid components rather than placing two visible faces
in the same plane: close coplanar overlapping triangles z-fight even when they
have different colours. Do not rely on polygon offset to hide bad geometry.
Avoid zero-area triangles (notably cones with a zero-radius tip), invalid
normals, tiny floating ornaments, reversed faces, excessive tessellation,
overly thin rails, random scale, or touching faces with overlapping areas.
Do not put sub-pixel letters on signs; suggest the sign with a bold board.

## Review and measurable gates

These are conservative automated floors, not a claim of artistic approval.
The visual gate compares each asset present/absent on the real grass and path
colours at daytime, at the actual 320×180 render resolution, in front, side and
game-camera views. It measures changed pixels and RGB difference; it cannot
recognise whether a wheelbarrow *looks* like a wheelbarrow. The context panel
shows the existing cottage, coops, trees and fence at their real scale. Numeric
ratios catch gross scale mistakes; model critique and Jiaxu/Look Dev review must
judge recognisability, proportions, material choices and the overall style.

```assetgen-rules
{
  "version": 1,
  "triBudgets": { "trees": 900, "rocks": 240, "fences": 240, "props": 700, "farm": 1200 },
  "maxColors": 8,
  "paletteDistanceRGB": 3,
  "dimensionToleranceRelative": 0.15,
  "dimensionToleranceAbsolute": 0.04,
  "minimumBoundsFraction": 0.75,
  "centerToleranceRelative": 0.10,
  "centerToleranceAbsolute": 0.035,
  "belowGroundTolerance": 0.01,
  "degenerateArea": 0.00000001,
  "zFightPlaneDistance": 0.003,
  "zFightNormalDot": 0.9999,
  "zFightOverlapArea": 0.000005,
  "legibility": { "pixelDeltaRGB": 8, "minimumPixels": 3, "minimumSpanPixels": 2, "minimumMeanContrastRGB": 8 },
  "referenceHeightRatios": {
    "trees": { "reference": "tree", "min": 0.20, "max": 1.65 },
    "rocks": { "reference": "fence", "min": 0.10, "max": 1.60 },
    "fences": { "reference": "fence", "min": 0.60, "max": 1.60 },
    "props": { "reference": "fence", "min": 0.18, "max": 2.20 },
    "farm": { "reference": "coop", "min": 0.30, "max": 1.35 }
  }
}
```
