# Lighting and graphics audit

Baseline: `origin/main` at `a61bac91e950ed3b03b3a3a6d3e1b3a57afe2671` (the local `main` is older). Values below describe that baseline, before the lighting correction. The background is always the signed `#101416` void; phase `sky` values are hemisphere/fog inputs, not the background.

## Baseline light inventory

All positions are world coordinates. Three.js directs a directional light **from its position toward its target**, here the default `(0, 0, 0)`; its rotation does not set the direction. There is one directional light, not a camera light. At the exact phase anchors, `createDayNightCycle.ts` computes:

| Phase | Directional position → target | Directional color / intensity | Ambient color / intensity | Hemisphere sky / ground / intensity | Lantern / window intensity |
| --- | --- | --- | --- | --- | --- |
| Morning | `(12, 3, 0)` → `(0, 0, 0)` | `#ffe8c8` / 0.55 | `#f0e0d0` / 0.25 | `#e8d4c8` / `#a8c090` / 0.55 | 0 / 0 |
| Daytime | `(0, 12, 6)` → `(0, 0, 0)` | `#fff2d6` / 1.1 | `#e8f0e8` / 0.15 | `#a8d4f0` / `#9cb88a` / 0.85 | 0 / 0 |
| Sunset | `(-12, 3, 0)` → `(0, 0, 0)` | `#ff8a50` / 0.65 | `#e89870` / 0.28 | `#f0a878` / `#c89070` / 0.45 | 0 / 0 |
| Night | `(6, 12, 6)` → `(0, 0, 0)` | `#c8d4f0` / 0.22 | `#3a4560` / 0.18 | `#2a2848` / `#1e2430` / 0.22 | 0.55 / 0.85 |

Cloudy and rain are weather overlays, not separate time phases. At fully cloudy, **each** row's directional intensity is multiplied by 0.72 (day 0.792, sunset 0.468, night 0.1584); ambient and hemisphere colors are multiplied in linear RGB by `(0.86, 0.96, 1.08)`, with their intensities unchanged. At full rain the directional multiplier is 0.8 (day 0.88, sunset 0.52, night 0.176), with ambient/hemisphere unchanged. The light positions, target, fog, practical lights and void do not change for either weather. Weather transitions in 1.75 s; phase light colors/intensities interpolate smoothly. Rain particles are not lights.

There are two cottage window `PointLight`s: each `#ffcc88`, peak intensity 0.85, distance 7, decay 2, attached to a window pane 0.7 units along its local +Z. Window materials reach emissive intensity 0.85 at night; the east window and two coop apertures are emissive accents only (0.85, 0.595, 0.595), not additional lights. The carried `#ffb060` `PointLight` has peak intensity 0.55, distance 3.5, decay 2, and is parented to the character's lantern at local `(0.72, 1.05, 0.5)`: toward its +Z face/front and to its right, rotating with the character. It and the glass emissive are **off at the exact daytime and sunset anchors**, then ramp up between sunset and night; they can contribute a prominent local front fill at night. There is no other character- or camera-attached light.

## Baseline shadows, materials and presentation

- `createScene.ts` does not enable `renderer.shadowMap`; the directional light's `castShadow` and every mesh's `castShadow`/`receiveShadow` remain Three.js defaults (`false`). Its unused default shadow camera is orthographic left/right/top/bottom `-5/5/5/-5`, near/far `0.5/500`, map `512×512`, bias and normalBias `0`. There is consequently no mapped shadow direction, shadow acne or peter-panning to compare.
- `createCharacter.ts` uses a centered, horizontal `CircleGeometry(0.4, 24)` contact blob, `MeshBasicMaterial #263b20`, opacity 0.22, depthWrite false, local height 0.04 and local scale `(1, 0.7)`. It rotates and moves with the character and its elevation follows the stairs, but its center/axis never follows the sun. Trees and the decorative chicken also have fixed contact blobs. These are not cast shadows and do not establish an opposite-sun direction.
- The body is smooth `CapsuleGeometry` with `MeshStandardMaterial #ffd477`, roughness 0.9; eyes and beak are also standard, non-emissive materials. No vertex colors, toon/gradient maps, flat shading or `DoubleSide` are used on the character. The lamp wing is standard and non-emissive; only the lantern glass emits. Three's capsule/sphere geometries supply outward normals and front-facing winding. Props predominantly use standard materials; tree crowns intentionally use flat normals, the cliff uses explicit flat outward normals and vertex colors, and the path computes normals. The blob, tree contact shadows, rain splashes and placement wash deliberately use unlit basic materials.
- `src/postprocess` is a single scene `RenderPass` on a low-resolution canvas, enlarged with CSS nearest-neighbor to approximately 4 CSS pixels. It does not posterize, tint, dither or flip the shading. Native comparison is `?pixel=0`; the HUD is not in this pass.

## Baseline diagnosis and reproduction

The root cause is excessive omnidirectional/hemispherical fill relative to the key, particularly sunset's ambient 0.28 plus hemisphere 0.45 against the warm directional 0.65. The camera-facing side remains bright when its normals face away from the sun. The daylight/sunset lantern is off, so it cannot be their cause; the correctly wound, non-emissive standard body and tint-free pixel presentation also rule out those proposed causes. At night the camera-facing moon and the very close, front-mounted lantern add a separate, substantial front fill: with a controlled backlight, the same 112 body pixels average **65.88** luminance with the 0.55 lantern versus **15.41** with its point light disabled. Its glass is not the body's emissive material.

`tests/browser/lighting.browser.mjs` ran against the unmodified `origin/main` scene before any source changes. The captured `evidence/lighting/before-detector.log` fails both the shading and shadow assertions, as intended. Its `before-measurements.json` records Chromium/SwiftShader, actual sample counts, both fixed azimuths and phase positions. Using 0–255 sRGB weighted luminance, at sunset the sun-facing/away-facing body averages **91.42 / 76.42** (difference 15.00, away/sunward 0.836); the opposite azimuth gives **94.48 / 78.86**. In a separate directly backlit/frontlit comparison of the *same* camera-facing pixels, sunset is **78.21 / 96.09** (ratio 0.814). Daytime is **127.49 / 94.49** and **136.07 / 97.82** for the two side azimuths; backlit/frontlit is **97.10 / 138.56**. The test's camera pose remains fixed, zooming only for the body measurements, and classifies real rendered body pixels using mesh raycasts rather than assuming their color or source positions.

The baseline daytime shadow's pixel centroid is **0.044 low-resolution pixels toward** the sun rather than away; it is effectively centered. Worse, on the actual sunset/night ground the green transparent blob *brightens* 13/21 pixels and darkens none, so its direction cannot even be measured as a dark shadow. This is a blending/color problem, not inverted geometry or a shadow-map bias. The ordinary before frames and their nearest-neighbor center crops are in `evidence/lighting/before-{daytime,sunset,night}-{full,character}.png`.

## Correction and measured result

The existing sun/moon arc, target, directional colors and intensities, fog, window lights, signed material colors, HUD, placement tints and pixel pass are unchanged. Only the flat fill intensities change:

| Phase | Ambient before → after | Hemisphere before → after | Directional after | Cloudy directional | Rain directional |
| --- | --- | --- | --- | --- | --- |
| Morning | 0.25 → 0.16 | 0.55 → 0.35 | `#ffe8c8` / 0.55 | 0.396 | 0.44 |
| Daytime | 0.15 → 0.10 | 0.85 → 0.55 | `#fff2d6` / 1.1 | 0.792 | 0.88 |
| Sunset | 0.28 → 0.12 | 0.45 → 0.20 | `#ff8a50` / 0.65 | 0.468 | 0.52 |
| Night | 0.18 → 0.18 | 0.22 → 0.22 | `#c8d4f0` / 0.22 | 0.1584 | 0.176 |

The color values in the baseline table remain the actual phase colors; cloudy still applies the same linear-RGB gains to those colors and rain leaves them alone. The lantern point light is now 0.08 peak, distance 2, decay 2, still `#ffb060` and still zero at day/sunset. Its glass stays at the original 0.55 emissive peak; window and coop glows stay unchanged. The existing contact shadow is stretched/offset away from the **same** directional target-to-light vector, independent of character yaw, and black alpha darkens rather than brightens the ground. It shortens near unsupported island/landing edges, preserving the void. This is deliberately a stylized ground-plane projection, not a newly enabled shadow-map system; see the limitation below.

| Controlled measurement (0–255 sRGB luminance) | Before | After |
| --- | --- | --- |
| Day sunward / away, azimuth `(-12,12,12)` | 127.49 / 94.49 | 115.52 / 77.57 |
| Day sunward / away, azimuth `(12,12,-12)` | 136.07 / 97.82 | 125.93 / 80.29 |
| Sunset sunward / away, azimuth `(-12,3,12)` | 91.42 / 76.42 | 74.80 / 54.64 |
| Sunset sunward / away, azimuth `(12,3,-12)` | 94.48 / 78.86 | 79.97 / 56.53 |
| Sunset same camera-facing pixels, backlit / frontlit | 78.21 / 96.09 (0.814) | 56.08 / 81.45 (0.688) |
| Night backlit pixels, lantern on / off | 65.88 / 15.41 | 31.06 / 15.41 |
| Day shadow centroid toward sun, render pixels | +0.044 | −2.575 |
| Sunset / night dark shadow pixels | 0 / 0 (brightened instead) | 63 / 44 |
| Sunset / night centroid toward sun, render pixels | not measurable | −5.901 / −2.886 |

The detector uses the real body/material, a fixed isometric camera pose and two opposing, known azimuths; it zooms for body sampling but keeps the 320×180 render buffer and 4-CSS-pixel presentation. Raycasts exclude the face and lantern, classify the cylindrical body by its outward radial normal, and sample the rendered pixels. It separately compares identical front-facing pixels with the key behind/in front. The shadow test compares rendered pixels with and without the shadow mesh at the actual phase positions; negative centroid projection means away from the sun in screen space. It also checks that the foot-pad shadow does not darken `#101416` void. Minimum side contrast is 18/255 with away/sunward ≤0.78; the backlit/frontlit ratio must be ≤0.72. Unit tests cover all 64 cycle steps and four character rotations.

Reproduce with `node tools/lighting-baseline.mjs` (archives the recorded main SHA, runs the *same current detector*, and **must fail** the old shading/shadow assertions) and `node --test tests/browser/lighting.browser.mjs` (must pass on this branch). `LIGHTING_URL=http://100.88.150.21:5184 LIGHTING_EVIDENCE_DIR=evidence/lighting LIGHTING_CAPTURE_LABEL=after` records the after screenshots and JSON. `before/after-*-full.png` are ordinary 1280×720 held-phase frames; `*-character.png` is a nearest-neighbor 5× center crop from the corresponding full frame, also 1280×720. `*-backlit.png` uses a test-only 3× camera zoom and known behind-camera azimuth to make the defect visible. `before-detector.log`, `before-baseline.json`, and the before/after measurement JSONs contain the exact proof.

## Other graphics audit

| Suggested ticket | Finding and screenshot reference | Disposition |
| --- | --- | --- |
| **Correct downward-wound path triangles** | The path's tight bend produces four downward-facing edge triangles and three downward-facing surface triangles; `path-before.png` hides the character and zooms the unchanged view, with counts in `path-before.json`. The rest of the character/prop geometries examined have consistent face/vertex winding; no mesh had a negative world determinant. | Small geometry correction, separately tracked. |
| **Stop contact shadows brightening at night** | The fixed tree and decorative-chicken blobs brighten rather than darken the ground: `prop-before-tree.png`, `prop-before-chicken.png`, `prop-before.json` (441/85 brightened render pixels). | Small blending correction, separately tracked. |
| **Resolve tree 4 / coop B roof intersection** | `before-roof-tree-crop.png`; the existing mesh probe in `evidence/EBR-47/browser-proof.json` found 328 overlapping 0.02-unit ray samples, not just overlapping screen silhouettes. | Report only: changing signed building/tree layout needs review. |
| **Stabilize pixel-world motion without changing the locked look** | `before-motion-a.png` and `before-motion-b.png` are 0.05 world units apart with the ordinary following camera; fine foliage and edges jump between 4-CSS-pixel cells. `before-audit-capture.json` records the positions. | Report only: snapping/interpolation changes camera feel and needs look review. |
| **Keep rain streaks legible at pixel resolution** | `before-rain.png` shows tiny scattered pixels; the 0.075–0.095-world-unit streaks project to roughly 2–3 CSS px, smaller than one 4-CSS-px world pixel. | Report only: animation/pixel treatment needs design and motion review. |
| **Evaluate subtle pond motion** | `before-pond-crop.png`: the water layers and three ripples are static geometry (`createFarmLayout.ts`), so it reads as a flat painted patch. | Report only: animation would change the approved look. |
| **Project player shadows across stepped receivers** | `after-stairs-edge.png`: the safe stylized blob shortens at the landing edge and remains on the current floor plane; it cannot cast onto lower steps or prop walls. | Report only: proper receiver-aware shadows are a larger rendering change. |

No obvious z-fighting, shadow acne/peter-panning, posterization, dither noise, or wrong void/fog color was observed in the inspected frames. This is not a claim that every angle or GPU is free of such artifacts.
