# Lighting and graphics audit

Baseline: `origin/main` at `c59b0433e4bec1b7d7dce6e69833dab6d64bdbaa`, including EBR-73 and EBR-48. Its lighting code is unchanged from `a61bac9`; the stream, bridge and waterfall are new. The background is the signed `#101416` void; phase `sky` values are hemisphere/fog inputs, not the background.

Sources read: `lookdev-lighting/LIGHTING-BRIEF.md`, its `proto-v2.png` and `scratch-values.diff`, `ebr48-look-lock.md`, and QA's `GRAPHICS-GATE.md`, `gfx-audit.mjs`, `analyze-lighting.py`, `compare-frames.py` and supplied main frames. Linear EBR-80 comment `dc2b4a90` was **not accessible**: this session exposes no Linear connector and the web page returned only “Loading…”. The detailed EBR-80 rulings supplied in the task were applied; the complete Linear comment remains unverified.

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

The key now has a fixed world azimuth `(-11, h, 4)` → `(0,0,0)` (screen upper-left). Only height, color and intensity vary. Signed farm, water, bridge, cottage, coop, stair and ghost material hexes, fog, HUD and pixel pass are unchanged. The light colors were adjusted at sunset to keep grass green and water blue; night fill is cool and below the moon key.

| Phase | Position / directional color / intensity | Ambient color / intensity | Hemisphere sky / ground / intensity | Character shadow X/Z |
| --- | --- | --- | --- | --- |
| Morning | `(-11,4,4)` / `#ffe8c8` / 1.4 | `#f0e0d0` / 0.08 | `#e8d4c8` / `#a8c090` / 0.25 | `(+0.451,-0.164)` |
| Daytime | `(-11,12,4)` / `#fff2d6` / 1.8 | `#e8f0e8` / 0.07 | `#a8d4f0` / `#9cb88a` / 0.35 | `(+0.250,-0.091)` |
| Sunset | `(-11,4,4)` / `#ffeddb` / 1.2 | `#eadbc8` / 0.08 | `#e8dec6` / `#b5b99a` / 0.20 | `(+0.451,-0.164)` |
| Night | `(-11,9,4)` / `#c8d4f0` / 0.7 | `#aeb8c9` / 0.4 | `#2a2848` / `#1e2430` / 0.20 | `(+0.150,-0.055)` |

Cloudy still applies the locked directional multiplier 0.72 and linear-RGB fill gains `(0.86,0.96,1.08)`; full rain uses a 0.70 key multiplier to retain the specified softer shade/lit ratio. At night only, cloudy multiplies fill intensities by 0.82 and rain by 0.80 so fill remains below the weather-dimmed moon. Thus clear/cloudy/rain key intensities are day 1.8/1.296/1.26 and night 0.7/0.504/0.49; night ambient+hemisphere intensities are 0.60/0.492/0.48. Transitions remain 1.75 s and continuous.

The carried lantern remains `#ffb060`, zero in day/sunset, now 0.08 peak, distance 2, decay 2; its glass keeps the original 0.55 emissive peak. `lantern-reach.json` compares the real point light on/off near the existing sign: one nearby ground sample gains 1.57/255 luminance and one sign sample 1.21, so the weak practical still reaches both. Window lights and window/coop emissive colors and intensities are unchanged. The body remains non-emissive `MeshStandardMaterial`, roughness 0.9, `FrontSide`: its Engineer-selected base is `#fff087` multiplied by 1.45 in linear space, with vertex multipliers from 1 to 1.4 for the lighter crown. No camera light or glow was added. Capsule normals/winding remain outward.

Black-alpha ground blobs follow the same key and shorten safely at island/stair/bridge edges. Trees use 1.8× the character offset; the cottage, both coops, chicken, bridge and waterfall lip get corresponding offsets. Cloudy halves offset/opacity; rain uses 0.49× offset and 0.20× opacity; night is faint. The waterfall shadow's base is inset on the island side so it cannot paint the void. No shadow maps were enabled. The EBR-48 waterfall retains its existing tilted water normals, `DoubleSide`, vertex alpha and 2× reflected-light shader; it is not emissive.

| Controlled measurement (0–255 sRGB luminance) | Before | After |
| --- | --- | --- |
| Day sunward / away, azimuth `(-12,12,12)` | 127.49 / 94.49 | 165.80 / 87.16 |
| Day sunward / away, azimuth `(12,12,-12)` | 136.07 / 97.82 | 188.99 / 89.69 |
| Sunset sunward / away, azimuth `(-12,3,12)` | 91.42 / 76.42 | 147.69 / 81.80 |
| Sunset sunward / away, azimuth `(12,3,-12)` | 94.48 / 78.86 | 166.94 / 83.78 |
| Sunset same camera-facing pixels, backlit / frontlit | 78.21 / 96.09 (0.814) | 83.75 / 169.52 (0.494) |
| Night controlled backlight, lantern on / off | 65.88 / 15.41 | 79.56 / 71.95 |
| Day shadow centroid toward sun, render pixels | +0.044 | −2.189 |
| Sunset / night dark shadow pixels | 0 / 0 (brightened instead) | 49 / 25 |
| Sunset / night centroid toward sun, render pixels | not measurable | −4.066 / −1.419 |

The detector uses the real body/material, a fixed isometric camera pose and two opposing, known azimuths; it zooms for body sampling but keeps the 320×180 render buffer and 4-CSS-pixel presentation. Raycasts exclude the face and lantern, classify the cylindrical body by its outward radial normal, and sample the rendered pixels. It separately compares identical front-facing pixels with the key behind/in front. The shadow test compares rendered pixels with and without the shadow mesh at the actual phase positions; negative centroid projection means away from the sun in screen space. It also checks that the foot-pad shadow does not darken `#101416` void. Minimum side contrast is 18/255 with away/sunward ≤0.78; the backlit/frontlit ratio must be ≤0.72. Unit tests cover all 64 cycle steps and four character rotations.

Reproduce with `node tools/lighting-baseline.mjs` (archives the recorded main SHA, runs the *same current detector*, and **must fail** the old shading/shadow assertions) and `node --test tests/browser/lighting.browser.mjs` (must pass on this branch). `LIGHTING_URL=http://100.88.150.21:5184 LIGHTING_EVIDENCE_DIR=evidence/lighting LIGHTING_CAPTURE_LABEL=after` records the after screenshots and JSON. Controlled backlit captures are diagnostic only: the actual shipped key is upper-left, not camera-backlit.

`review-{before,after}-{phase}-{weather}-full.png` are seeded, fixed-URL 1280×720 whole-island views. The matching `-water.png` frames show stream, bridge and waterfall at 1.5× camera zoom. For day/sunset/night, `-toward-crop.png` and `-away-crop.png` are true 4× nearest-neighbor crops from the normal pixel pass; `-toward.png`/`-away.png` are separate 3× camera views. `review-before.json`, `review-after.json`, `before-detector.log`, `before-baseline.json`, and `detector-final/suite-{measurements,phase-gate}.json` record settings and numbers.

### Phase/facing measurements

The QA-compatible probe uses 0–255 luminance. Facing order is toward camera / away / left / right. Shade/lit is away-facing half divided by sun-facing half; bounds are minima, not target retunes.

| Case | Shade/lit before → after (minimum) | Asymmetry before → after | Facing luminances before → after | Ground contrast before → after |
| --- | --- | --- | --- | --- |
| Morning | 0.831 → 0.740 (0.50) | 0.185 → 0.298 | 110.7/118.0/120.0/118.0 → 105.9/110.8/101.1/110.8 | 1.44 → 1.40 |
| Day | 0.852 → 0.708 (0.55) | 0.160 → 0.342 | 114.9/121.4/121.3/121.4 → 109.7/114.6/106.9/114.6 | 1.13 → 1.10 |
| Sunset | 0.985 → 0.741 (0.45) | 0.015 → 0.297 | 76.4/80.4/80.3/80.4 → 99.5/103.9/95.0/103.9 | 1.26 → 1.36 |
| Day cloudy | 0.874 → 0.749 (0.70) | 0.134 → 0.287 | 107.4/113.6/113.6/113.6 → 102.8/108.0/101.3/108.0 | 1.15 → 1.17 |
| Day rain | 0.871 → 0.763 (0.75) | 0.137 → 0.269 | 111.4/117.4/117.4/117.4 → 104.3/109.8/103.1/109.8 | 1.15 → 1.18 |
| Night clear | 0.973 → 0.849 (no bound) | — | 62.1/36.8/70.7/36.7 → 84.1/82.7/84.7/82.7 | 1.21 → 1.35 |
| Night rain | 0.973 → 0.862 (no bound) | — | 60.8/33.6/68.7/33.6 → 76.5/74.1/77.5/74.1 | 1.26 → 1.36 |

Sunset visible body/top is 0.944 → 0.778 (maximum 0.80). Night clear/rain minima are 82.7/74.1 and spreads are 2.4%/4.5% (minimum 45/255, maximum spread 35%). `qa-main-c59-analysis.txt` and `qa-c59-post-analysis.txt` are the separate real-input checks; slight rain/ground differences reflect their unseeded particles and timed key holds.

The real 4-CSS-px sunset samples in `region-proof.json` are: grass `(67,65,20)` → `(64,81,35)`, G/R **1.266**; pond `(45,42,31)` → `(41,52,51)`; stream `(45,43,32)` → `(41,54,54)`; waterfall `(86,77,60)` → `(93,114,114)`. All water samples retain blue without changing any water hex. At night the sampled roof/wall/coop A/coop B luminances are respectively 21.1/44.4/19.2/19.2 above the void (night rain 16.5/61.8/15.0/15.0; a seeded streak can affect the wall sample). The two HUD rectangles have zero changed pixels in all seven seeded frames; an empty void sample remains `(16,20,22)` / `#101416`, and both runs use the 320×180 / 4-CSS-px pass.

### Engineer: unresolved gate conflicts

The supplied unmodified QA analyzer is **not green**: `qa-main-c59-analysis.txt` has 23 failures and `qa-c59-post-analysis.txt` has 10. On the post-rebase candidate its C1 and C3 checks pass, as do the sunset/night contrast checks, but:

1. **C2 versus the specified offset.** Look Dev's day offset `(+0.25,-0.09)` is 0.266 units; exactly half in cloudy is 0.133 and nearly centered rain is 0.130. QA requires ≥0.15 whenever key intensity ≥0.5. The direction cosine is 1.00 in both cases. Engineer retained the specified offsets rather than silently enlarging them; QA/Look Dev must reconcile the threshold. Night cloudy similarly has a 0.08 offset with a 0.504 key.
2. **C4 daytime luminance versus hue allowance.** The raw analyzer reports day/cloudy/rain contrast about 1.10/1.16/1.18, below 1.30. The fixed-view body/adjacent-grass hue separations are about 37°/33°/37°; the character hue lift is limited to the character and no farm palette hex was changed. Engineer retained that hue separation instead of overexposing/recoloring the signed palette. A Look Dev/QA ruling is still required; the analyzer's failures remain failures.
3. **C5 versus EBR-48 waterfall animation.** EBR-48 requires stepped scrolling at 0.25 units/s; the QA tool demands four identical full frames with no input. Both main and candidate fail that raw check. `waterfall-motion-check.log` and `waterfall-motion-proof.json` show zero exact changed pixels outside the visible waterfall mask in all five non-rain cases. This is not a replacement or a pass for the raw C5 gate; QA must decide how to exclude the intentional animation.

The task authorizes pushing/opening a PR **only after green gates**. Since the supplied QA analyzer exits 1, Engineer has not pushed or opened a PR. Do not re-baseline Gate G until Look Dev signs.

### Parity and comparison

The original EBR-73 baseline at `a61bac9` is byte-for-byte unchanged. `PARITY_EVIDENCE_DIR=evidence/lighting/gate-g npm run parity` uses a copy of that baseline and exits 1, as expected for lit frames. Changed pixels: spawn 265,136; stairs-pad 230,160; placement ghost 264,743; day 267,648; night 265,136; rain 265,136; cottage/coops day 558,016; cottage/coops night 557,968. `npm run lighting:parity` adds sunset and cloudy (265,136 each). These frames change from the new lighting/shadows **and** the EBR-48 water feature relative to the older baseline. The old direct stairs click now crosses water, so the harness uses real clicks via the bridge; stairs-pad and day position/yaw/camera differ from the pre-water baseline and are recorded, not hidden.

QA's `compare-frames.py` reports all 70 full lit frames changed (`qa-compare-raw.log`); `qa-compare-allowed.log` explicitly allows those lit-frame changes and is not a claim of world pixel parity. The independent seeded region check verifies HUD, void sample and 4-pixel presentation separately. No Gate G reference was re-recorded.

## Other graphics audit

| Suggested ticket | Finding and screenshot reference | Disposition |
| --- | --- | --- |
| **Correct downward-wound path triangles** | The path bend had four downward edge and three downward surface triangles. `path-before.png`, `path-after.png`, their JSONs and `path-before-test.log` show 7 → 0; the two fixed-view frames differ by 0 pixels. The character/prop winding check also covers the new water geometry. | Fixed separately in `fix: keep path triangles facing upward`. |
| **Unfold the tight path ribbon** | `path-after.png` and `path-overlap.json`: the ribbon still self-overlaps at the bend (323 edge / 163 surface sampled points at 0.01-unit spacing). Same-colored coplanar triangles show no visible flicker in the captured frames, but could z-fight after future material changes. | Report only: reshaping the signed route is not a tiny normals fix. |
| **Stop contact shadows brightening at night** | `prop-before-tree.png` / `prop-after-tree.png`: 438 brightened render pixels → 0; the new blob darkens 437. Chicken frames and JSONs are also recorded. | Fixed with the separately committed key-aligned farm shadows. |
| **Make the lantern grip legible** | The old 0.055-radius wing was often a subpixel gap; `review-arm-before-night-clear-{toward,away}.png` and matching `review-arm-after-*` show the same endpoints with a 0.08-radius wing. Point-light and glass colors are unchanged. | Tiny separate fix; body/lantern overlap is tested. |
| **Review east-gable window contrast** | `window-audit.png` and `window-audit.json`: east/front panes are all 0.8×0.8 with emissive intensity 0.85. East mean/max luminance 158/182 is not greater than front 168–180/191–194, but its emissive lift against the darker wall is 116 versus 85–93; the coop roof also partly occludes it. | Report only: perceived hotness/composition needs Look Dev review; no signed pane retune. |
| **Resolve tree 4 / coop B roof intersection** | `before-roof-tree-crop.png`; the existing mesh probe in `evidence/EBR-47/browser-proof.json` found 328 overlapping 0.02-unit ray samples, not just overlapping screen silhouettes. | Report only: changing signed building/tree layout needs review. |
| **Stabilize pixel-world motion without changing the locked look** | `before-motion-a.png` and `before-motion-b.png` are 0.05 world units apart with the ordinary following camera; fine foliage and edges jump between 4-CSS-pixel cells. `before-audit-capture.json` records the positions. | Report only: snapping/interpolation changes camera feel and needs look review. |
| **Keep rain streaks legible at pixel resolution** | `before-rain.png` shows tiny scattered pixels; the 0.075–0.095-world-unit streaks project to roughly 2–3 CSS px, smaller than one 4-CSS-px world pixel. | Report only: animation/pixel treatment needs design and motion review. |
| **Keep rain from reading as stars over the void** | `review-after-night-rain-full.png` and `review-after-daytime-rain-full.png` show sparse specks over the void and weak contrast over grass. | Report only: particle masking/scale is not a tiny lighting fix. |
| **Evaluate subtle pond motion** | `before-pond-crop.png`: the water layers and three ripples are static geometry (`createFarmLayout.ts`), so it reads as a flat painted patch. | Report only: animation would change the approved look. |
| **Review the flat void as a deliberate backdrop** | `review-after-daytime-clear-full.png` shows the flat surround. | Report only: `#101416` is expressly locked; no sky was added. |
| **Project player shadows across stepped receivers** | `after-stairs-edge.png`: the safe stylized blob shortens at the landing edge and remains on the current floor plane; it cannot cast onto lower steps or prop walls. | Report only: proper receiver-aware shadows are a larger rendering change. |

No obvious z-fighting, shadow acne/peter-panning, posterization, dither noise, or wrong void/fog color was observed in the inspected frames. This is not a claim that every angle or GPU is free of such artifacts.
