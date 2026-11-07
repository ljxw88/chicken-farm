# EBR-85 verifier coverage and limits

This is Engineer's self-test, **not** independent QA acceptance. Look Dev's
art verdict and QA's game gate apply only to an exact tested SHA. Historical
handoffs and outputs are archived outside git under
`/home/michael/OpenBot/Shared/farm-evidence/EBR-85/pr21-tracked/`.

| QA item | Current status and boundary |
| --- | --- |
| A1 | Recipe builds twice and hashes geometry/materials/transforms; browser errors fail. No showcase is in this PR. |
| A2 | ±10% bounds and metadata are checked; signed-reference scale composites are rendered. By-eye fit is not signed. |
| A3 | Base and centre are checked; `facing` must be `+Z`. Semantic front direction still needs the critic/Look Dev. |
| A4 | Ground, triangle contact and connectivity are checked; below −0.01 is rejected. Malformed custom meshes remain lower-trust. |
| A5 | 0.1 floor, 0.2 readable thickness, and 0.3 handle/wheel/window/hat dimensions are checked. Pixel recognisability remains by eye. |
| A6 | Non-finite, degenerate, hidden, zero-scale, texture and material-bypass cases have negative tests. |
| A7 | New-recipe coplanar overlaps and a sub-minimum skin straddling another part's face fail analytically. Exact signed legacy references retain analytic warnings, then run 24 yaws with a 0.001-unit camera jitter. The detector excludes antialiased silhouette edges; edge flicker is **not checked**. QA must calibrate the new-recipe false-positive policy. |
| A8 | Palette tokens and allowed extensions are enforced; body emissive, PointLight, texture, transparency, text, vertex-colour/baked shading and unapproved hues fail. Lantern-post glass is the sole emissive exception; night frames also reject blown highlights. |
| A9 | Albedo-normalised estimates use the per-phase minimum of the signed coop/fence/tread, with source and reference hashes and remeasurement on change. Tree-class flora has no numeric floor and requires by-eye review. The separate S4 direction check remains; the full QA G1/G2 phase-band method is **not checked**. |
| A10 | Eight fixed yaws against grass, path and void are measured for morning, day, sunset, night and seeded night-rain using luminance contrast or CIE76 ΔE. Day/morning/sunset are strict; at night contrast and path/void area are advisory while the grass-pixel floor stays hard. The exact signed fence is the sole S2 legacy warning: its approved end-on silhouette is narrow. Human recognisability remains **not checked**. |
| A11 | Actual game placement, walking, neighbouring collision and ghost interactions are **not checked**; deferred to EBR-86. |
| A12 | Walking-frame shimmer/alignment is **not checked**; deferred to EBR-86. |
| A13 | Automated anti-example heuristics are only a coarse floor. Independent Look Dev style signoff is **not checked**. |

`tests/assetgen-qa.test.mjs` exercises B1–B18 by named failure, plus 0.09/0.11
threshold edges, a hidden sliver, invisible/zero-scale geometry, transformed
groups, palette bypass, stale hashes and a forged PASS report. The external
fixture CLI is tested without modifying its input folder. The four signed
fixtures use only explicitly named real-game references and locked geometry
fingerprints: their legacy warnings are not exemptions for generated assets.

The browser visual gate is an approximation: pixel differences show a tagged
part contributes visible pixels, not that a viewer recognises its identity.
The A7 jitter probe cannot rule out flicker in discarded edge pixels. H4 cannot
infer an object's semantic front merely from a +Z string. The recolour-only
detector compares scale-normalised primitive geometry; sophisticated near-copy
variants and off-style assets still need independent review. A signoff JSON is
a separate audit artifact, not a cryptographic proof of the reviewer's identity.

At source commit `6d49d0e9e43ccebf14e038d618719b611cfab2e3`, the explicit
`asset:verify -- --signed all` run returned PASS for tree, coop, fence and
stair tread. Each ran 24 jittered yaws; interior sampled pixels were
2,750 / 5,597 / 435 / 5,214 respectively, with zero unmatched interior
changes. The corresponding 2,894 / 2,255 / 1,163 / 1,718 excluded edge
pixels are **not** asserted flicker-free. Analytic overlaps, signed legacy
materials and signed-fence low-area side silhouettes remain printed warnings.
The report and fixed frames are under the archive's
`evidence/assetgen/ebr83-85/signed-head-6d49d0e/`.
The raw log names its original `/tmp` directory; the corresponding complete
frame folders were copied unchanged into the evidence directory above.
Any later commit changes HEAD; independent QA must retest the final tip.
