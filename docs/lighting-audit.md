# Lighting and graphics audit

> Historical `evidence/` and `DELIVER*.txt` references are under `/home/michael/OpenBot/Shared/farm-evidence/_main-archive-843c242/`, except required inputs retained in `tools/fixtures/historical/`.

Baselines: `origin/main` at `c59b0433e4bec1b7d7dce6e69833dab6d64bdbaa` (EBR-73 + EBR-48), and PR #17's preceding tip `bf8ac5f5702277f1d55aefbffe130e56e7ef8540` for the latest Look Dev comparison. The background is the signed `#101416` void; phase `sky` values are hemisphere/fog inputs, not the background. The current tip is `git rev-parse HEAD`; a commit cannot contain its own SHA.

Sources: `lookdev-lighting/LIGHTING-BRIEF.md`, its `proto-v2.png` and `scratch-values.diff`, `ebr48-look-lock.md`, QA's `GRAPHICS-GATE.md`, `gfx-matrix.mjs`, `analyze-gate.py`, `gfx-audit.mjs`, `analyze-lighting.py`, supplied main frames, and the written rulings supplied for EBR-80. QA's v2.3 changelog records Look Dev rulings `9e8c543c` / `15a7cd92`; the latest supplied Look Dev ruling is `cde29baf`, with PM note `624878a1`. Linear comments were not independently accessible because this session has no Linear connector; the supplied rulings and QA record were used.

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

**Look Dev ruling:** rotate the fixed upper-left key toward the camera within the permitted `(-0.94,+0.34)` to `(-0.80,+0.60)` horizontal range. **Engineer:** select the `(-0.80,+0.60)` endpoint, keeping the previous horizontal radius and elevation. The shadow directions follow the key while their specified lengths stay fixed. Morning uses key 2.35 and ambient 0.20 instead of `bf8ac5f`'s 1.40 and 0.08; the warm light colors are unchanged.

| Phase | Position / directional color / intensity | Ambient color / intensity | Hemisphere sky / ground / intensity | Character shadow X/Z |
| --- | --- | --- | --- | --- |
| Morning | `(-9.364,4,7.023)` / `#ffe8c8` / 2.35 | `#f0e0d0` / 0.20 | `#e8d4c8` / `#a8c090` / 0.25 | `(+0.384,-0.288)` |
| Daytime | `(-9.364,12,7.023)` / `#fff2d6` / 1.8 | `#e8f0e8` / 0.07 | `#a8d4f0` / `#9cb88a` / 0.35 | `(+0.213,-0.160)` |
| Sunset | `(-9.364,4,7.023)` / `#ffeddb` / 1.2 | `#eadbc8` / 0.08 | `#e8dec6` / `#b5b99a` / 0.20 | `(+0.384,-0.288)` |
| Night | `(-9.364,9,7.023)` / `#c8d4f0` / 0.52 | `#aeb8c9` / 0.26 | `#2a2848` / `#1e2430` / 0.11 | `(+0.128,-0.096)` |

Cloudy applies directional ×0.72 and linear-RGB fill gains `(0.86,0.96,1.08)`; full rain applies directional ×0.70. At night only, cloudy/rain also multiply fill intensities by 0.82/0.80. Weather transitions remain continuous. **Look Dev ruling:** restore the carried lantern's signed 3.5 range. **Engineer:** peak intensity 0.12, `#ffb060`, off by day/sunset; glass emissive remains 0.55. No camera light, new light, shadow map or emissive body was added.

### Complete color and material change ledger

All values are sRGB hex unless a linear shader multiplier is stated. The main baseline and the intermediate PR tip are both shown; **no change is silent**.

| File / material | Old → current | Reason / attribution |
| --- | --- | --- |
| `src/character/createCharacter.ts` body | Main `#ffd477` ×1 → `bf8ac5f` `#fff087` ×1.45 (runtime `#ffffa0`) → **`#ffd477` ×1** | **Look Dev ruling:** restore the signed body. QA runtime dump and unit test both confirm `#ffd477`, with no base gain. Roughness 0.9 and non-emissive material are unchanged. |
| Same body crown | Main ×1 (no vertex lift) → `bf8ac5f` maximum ×1.40 → maximum **×1.15** | **Look Dev ruling:** crown ≤1.15. **Engineer:** retained the small lift for night readability; see the subtract-before-add evaluation below. |
| Same body shade shader | Main/`bf8ac5f`: no bounce shader → key-away indirect irradiance mixed up to 0.30 toward daytime `(4.50,2.80,0.80)` or night `(3,0,0)` in linear RGB; at night shaded outgoing green/blue are also reduced up to 3%/30% | **Engineer:** warm darker gold and ≥25 ΔE separation from grass after the azimuth/night retune; the signed material hex and lit crown remain unchanged. Restoring the signed body removes the clipped pale crown. |
| `src/character/createCharacter.ts` contact blob | Main `#263b20` → `bf8ac5f` `#000000` → **`#0a1409`**, clear-day opacity 0.22 | **Look Dev ruling:** dark green-black, not pure black. |
| `src/scene/createFarmLayout.ts` tree contacts | Main `#3d7a3a` → `bf8ac5f` `#000000` → **`#0a1409`**, clear-day opacity 0.16 | **Engineer:** preserve main's tree-shadow green hue at about one-sixth sRGB brightness so it still darkens night ground. Shared constant: `src/scene/contactShadowStyle.ts`. |
| `src/scene/createFarmDecorations.ts` chicken contact | Main `#263b20` → `bf8ac5f` `#000000` → **`#0a1409`**, clear-day opacity 0.18 | **Look Dev ruling:** same dark green-black family as the tree contacts. |
| `src/scene/createFarmShadows.ts` cottage, coop 1, coop 2, bridge and waterfall-lip contacts | Main: absent → `bf8ac5f` `#000000` → **`#0a1409`**, clear-day opacity 0.12 each | **Look Dev ruling:** no pure-black blobs. **Engineer:** new visible low-opacity offset shadows; listed individually in the READY note below. |
| `src/lighting/createSunsetWaterTint.ts` pond, stream and waterfall reflected light | No output tint → **blue ×1.20 at sunset**, smoothly fading to ×1 at morning/day/night anchors | **Look Dev ruling:** sunset water B ≥ G and B−R ≥10. The signed pond/stream `#5b8fa8`, rim `#7aadb8`, depth `#3a6a7a`, foam `#bfe0e6`, fall `#8fc1cf` and streak `#ddeff2` material/vertex hexes remain unchanged. The existing waterfall ×2 reflected-light shader and animation are retained. Morning water brightens only because the whole morning scene is brighter. |
| `src/lighting/dayNightPhases.ts` sunset lights | Main directional `#ff8a50` → `#ffeddb`; ambient `#e89870` → `#eadbc8`; hemisphere sky `#f0a878` → `#e8dec6`, ground `#c89070` → `#b5b99a` | **Engineer:** earlier EBR-80 light-color choices for green grass and blue water; not new material palette hexes. No further light-color changes in this revision. |
| `src/lighting/dayNightPhases.ts` night ambient light | Main `#3a4560` → `#aeb8c9` | **Engineer:** earlier EBR-80 cool night fill; unchanged in this revision. Moon, lantern and window light hexes are unchanged. |
| `src/lighting/dayNightPhases.ts` morning light intensities | Main key/ambient `0.55/0.25` → `bf8ac5f` `1.40/0.08` → **`2.35/0.20`** | **Engineer:** brighter warm-cream morning; morning light hexes stay unchanged. |
| `src/lighting/dayNightPhases.ts` night light intensities | Main key/ambient/hemisphere `0.22/0.18/0.22` → `bf8ac5f` `0.70/0.40/0.20` → **`0.52/0.26/0.11`** | **Engineer:** darken night grass toward 1.5× main while preserving readable body and practical-light pools; light hexes remain unchanged. |
| `src/lighting/dayNightPhases.ts` lantern point light | Main `#ffb060`, peak/range `0.55/3.5` → `bf8ac5f` `0.08/2` → **`0.12/3.5`** | **Look Dev ruling:** restore signed range. **Engineer:** intensity restores a warm local ground pool without a face brighter than the key-lit top; color/decay/glass stay unchanged. |
| `src/lighting/createDayNightCycle.ts` key azimuth | `bf8ac5f` horizontal direction `(-0.94,+0.34)` → **`(-0.80,+0.60)`** | **Look Dev ruling:** rotation is allowed within this range. **Engineer:** selected the camera-side endpoint for warmer door-side plaster; light color, elevation and shadow lengths remain unchanged. |
| `src/lighting/createPracticalLights.ts` lantern wing | Main separate wing `#ffd477`, radius 0.055 → same `#ffd477`, radius 0.08 | **Engineer:** visible wing/grip split and thicker connector; endpoints and color unchanged. |

The earlier sunset light intensities from main were directional/ambient/hemisphere `0.65/0.28/0.45` → `1.2/0.08/0.20`; day `1.1/0.15/0.85` → `1.8/0.07/0.35`. The rain key multiplier remains 0.8 → 0.7. Farm/building/ghost palette tokens, void, HUD and pixel-pass settings are unchanged. The sunset-only water tint and green-black contact-shadow style are included: both are explicitly within the preceding Look Dev rulings and are tested by unit, browser and QA checks.

### READY note — VISIBLE CHANGES for Look Dev

- The lantern wing/grip is a separate visible `#ffd477` mesh, radius **0.055 → 0.08**; the body is again the same signed base color. Review the wing split/seam.
- New `cottage-shadow`, `ramp-coop-1-shadow`, `ramp-coop-2-shadow`, `wooden-bridge-shadow` and `waterfall-lip-shadow`: **each `#0a1409`, opacity 0.12 at clear day**. The character, tree and chicken contacts are also now `#0a1409`, at clear-day opacities 0.22/0.16/0.18 respectively. All offset lower-right, away from the key; cloudy/rain and night scale opacity down. These are visible additions/changes, not unchanged main artwork.
- The stale `READY.md` is removed; `DELIVER.txt` is updated for the PR handoff. Visual Look Dev review remains by eye. No merge, auto-merge or ready-state operation is performed.

### Probe and QA definitions

`tools/lighting-probe.mjs` loads the real scene at 1280×720 with the pixel pass **off**, a seeded random stream and settled weather. It simulates S/W/A/D for 0.25 s each, follows the character and samples the **away-W** frame. The projected capsule center is `(cx,cy)`, its horizontal radius is `r`, and its projected half-height is `hh` (±1 world unit projected, then ×0.7). It averages sRGB luminance `0.2126R + 0.7152G + 0.0722B` in the left/right rectangles `cx−0.85r..cx−0.2r` and `cx+0.2r..cx+0.85r`, both `cy±0.3hh`. The sign of the key's screen-right projection classifies the keyward rectangle as **lit** and the other as **shade**; the contract is shade/lit of this same body, not side/top. It does not raycast normals for these two rectangles. The older probe `contrast` uses an adjacent rectangular ground sample and `(max(L)+12.75)/(min(L)+12.75)`; it is **not** QA C4. The shade hue is HSV hue of the shade rectangle's mean RGB; for shade/grass ΔE the grass reference is the per-channel median of a 13×13 neighborhood around world `(-5.3,2.405,3.4)`, reducing rain-streak sensitivity.

**Color-space method:** the accepted probe/QA calculation uses the analyzer's `(channel/255)^2.2` approximation before CIE76/D65 conversion. With standard IEC sRGB decoding instead, the same samples give night-cloudy **22.83** and night-rain **24.20** ΔE, versus QA-approximation **26.13** and **27.65**. This method difference is informational and is not concealed by the passing QA-method test. `tools/lighting-shade-deltae.py` and `ruling-cde29baf/shade-deltae-methods.json` record both calculations; no lighting was changed for this follow-up.

QA `analyze-gate.py` v2.3 now uses the same shade/lit strips. Its **advisory side/top** is the mean of both side strips divided by the crown rectangle `cx±0.4r`, `cy−0.95hh..cy−0.70hh`; this is a different ratio. QA's capture holds W from spawn rather than the probe's S-then-W sequence, so nearby ground samples can differ. QA C4 takes per-channel medians of 12 body pixels and six surrounding pixels, converts RGB with `(channel/255)^2.2`, computes `(lighter+0.05)/(darker+0.05)` and CIE76 ΔE. This run's rain-day result is **1.546 / ΔE 18.5**, body `(119,101,48)` and ground `(77,78,44)`; the ground sample can differ with the timed input pose. `qa-lookdev-rulings/metrics.json` and `RESULT.txt` preserve the actual QA capture and definitions; `tools/summarize-qa-matrix.py` reproduces them.

### Phase measurements

Each cell is QA **shade/lit / advisory side/top**, using the actual 12-case crisp-away matrix (`0–255` sRGB luminance). Night shade/lit has no specified G2 floor.

| Phase | Clear | Cloudy | Rain |
| --- | --- | --- | --- |
| Morning | 0.690 / 0.941 | 0.743 / 0.958 | 0.762 / 0.964 |
| Day | 0.697 / 0.674 | 0.750 / 0.706 | 0.771 / 0.718 |
| Sunset | 0.721 / 0.942 | 0.765 / 0.953 | 0.772 / 0.950 |
| Night | 0.667 / 0.729 | 0.672 / 0.732 | 0.684 / 0.739 |

The full side/top numerator and denominator are saved in `qa-lookdev-rulings/metrics.json`. **Engineer evaluation before the final azimuth/night retune:** with the signed body and bounce, removing the crown entirely gave night clear/rain minimum facing luminance 58.4/52.2, versus 60.4/54.0 with the permitted ×1.15 crown; day-rain shade/lit was 0.759 versus 0.762. The earlier `#fff087` ×1.45 body lift was removed entirely. The sampled day crown's pale `(R≥250,G≥245)` fraction fell from **5.5% at bf8ac5f to 0%**.

Shade-side HSV hue, preceding PR tip → current, versus fixed grass hue: day **73.1° → 46.4° vs 101.7°**; sunset **44.7° → 33.8° vs 82.2°**; day rain **73.1° → 46.4° vs 103.3°**. The shade/grass CIE76 ΔE is approximately 32.0 day, 29.4 sunset, 28.9 day rain and at least 26.1 across the three night weathers. These are rendered sample colors, not material hexes.

Fixed 1280×720 frame mean luminance (0–255 sRGB): grass rectangle `(300,375,450,415)`, and a common 267,548-pixel foreground mask from the `bf8ac5f` day frame excluding HUD and `#101416` void. Morning / day / sunset: grass **91.65 / 103.68 / 72.75**; visible whole island **80.22 / 82.30 / 63.70**. Before this revision, morning was 75.86 grass / 64.13 island. `tools/lighting-frame-metrics.py` and `lookdev-frame-luminance.json` reproduce the means, zero changed HUD pixels in all seven seeded views, the preserved shadow lengths and their alignment to the rotated key. Water in other phases receives no sunset tint, though the approved global relighting changes its rendered pixels.

Sunset fixed grass sample and QA's 13×13 median are `(63,81,35)`, **G/R 1.286**. QA 7×7 median water samples: pond `(41,52,55)`, B−G **+3**, B−R **+14**; stream `(45,58,61)`, **+3 / +16**; downstream stream `(42,57,63)`, **+6 / +21**; waterfall `(111,131,142)`, **+11 / +31**.

Night clear fixed grass is main `(18,36,20)` → `bf8ac5f` `(34,63,34)` → **`(29,54,29)`**, approximately 1.61×/1.50×/1.45× main. The probe's darkest facing is 52.0 clear, 45.5 cloudy and 46.0 rain, with spreads 11.8%/15.0%/14.6%. QA's toward-camera lantern-lit face/top is **62.20/71.41**, **58.49/62.26** and **58.67/62.23** respectively; no face is brighter than the top. `lantern-retune/pool.json` records a nearby ground sample `(52,41,33)` → `(59,44,33)`, a **3.63/255** warm luminance lift when the restored 3.5-range lantern is on.

Door-side plaster at fixed pixel `(571,269)` changed `bf8ac5f` → current from `(128,113,88)` → `(183,160,125)` in morning and `(115,112,92)` → `(139,132,107)` in daytime; the signed plaster material itself is unchanged. The new shadow world direction is opposite the new key; the daytime clear center projects `(+9.48,−0.39)` screen pixels relative to the foot (the vertical difference is subpixel and includes the 0.04-world-unit shadow lift).

### Controlled directional detector

| Measurement (0–255 luminance) | Main | Current |
| --- | --- | --- |
| Day sunward / away, two opposite azimuths | 127.49/94.49; 136.07/97.82 | 127.48/80.53; 143.86/83.50 |
| Sunset sunward / away, two opposite azimuths | 91.42/76.42; 94.48/78.86 | 115.70/77.00; 129.84/79.33 |
| Sunset same camera-facing pixels, backlit / frontlit | 78.21/96.09 (0.814) | 79.13/131.62 (0.601) |
| Night backlit face, lantern on / off | 65.88/15.41 | 52.14/41.42 |
| Day shadow centroid toward sun, render pixels | +0.044 | −2.453 |
| Sunset / night dark shadow pixels | 0 / 0 | 50 / 22 |

This separate detector raycasts body normals at controlled azimuths, compares the same front-facing pixels backlit/frontlit, and compares shadows on/off. `detector-retune/retune-measurements.json` has the current samples; the foot-pad void check changes zero void pixels. Negative centroid projection is away from the key. Controlled azimuths are diagnostic only; the shipped key remains upper-left.

**QA stair-check discrepancy:** the unmodified matrix route clicks the pad at `x=12.8`, where the lower capsule still touches the last raised tread. The actual pad top is `y=0.16`, the visible shadow is correctly on it at `y=0.20`, and the capsule origin is raised to `y=0.3446` to avoid intersecting the tread. QA's origin-gap formula consequently reads `−0.1446` and fails its `−0.10` limit even though the shadow is on the pad. `detector-retune/retune-pad-transition.png` and `retune-measurements.json` record this pose; the independent rendered/geometry test checks the receiving surface rather than moving the shadow into the air or changing walking behavior. This is a raw QA failure, not a claimed pass.

### Look Dev rulings and QA status

1. **Look Dev C2:** specified cloudy 0.133 and rain 0.130 daytime offsets are accepted; they point opposite the key. QA v2.3 uses a 0.10 cloudy floor and no rain/night floor.
2. **Look Dev G2:** use shade/lit of the same body with minima 0.50 morning, 0.55 day, 0.45 sunset, 0.70 cloudy and 0.75 rain. Side/top is advisory except day-clear's ≥0.54 sanity check.
3. **Look Dev C4 (`cde29baf`, PM note `624878a1`):** the ruled ΔE ≥25 comparison is the shaded-front mean versus grass. Luminance-only or body/path contrast below 1.15 is accepted for EBR-80 and tracked as EBR-82 item 3; there is no separate night body/path contrast floor. The previous night-C4 assertion was an **Engineer** over-constraint and was removed. **INFO:** at the QA-style W pose, night clear/cloudy/rain body-versus-local-ground contrast is 1.082/1.133/1.113 and ΔE is 13.9/15.2/15.0. These are different samples from shade/grass and remain visible in QA's INFO rows.
4. **Look Dev C5:** the stepped waterfall is the EBR-48 lock. QA masks `500,540,550,668` in still-frame checks; no animation was changed.
5. **Look Dev:** signed `#ffd477`, crown ≤1.15, green-black blobs, blue sunset water, brighter morning, restored 3.5 lantern range, darker night and the camera-side key azimuth as recorded above; final appearance remains subject to visual review.

QA's earlier v2.1 report on `bf8ac5f` was **5/88 failures**; main `c59b043` was **28/88**. The v2.3 capture on `a83c18a` reports **92 PASS, 4 INFO, 1 FAIL / 97**: the raw G5 pad-origin check above. The optional legacy `C4_STRICT=1` mode reports **4 FAIL / 97**: that G5 check and three accepted night C4 values; it is not the Look Dev contract. These are different analyzer versions and must not be compared as identical raw gates. `qa-lookdev-rulings/RESULT.txt`, `RESULT-C4-strict.txt`, `matrix.json` and frames preserve the capture. This follow-up changes only tests, documentation and evidence; it does not alter the captured scene. The analyzer SHA-256 was `4b02fad560b85c48dce083a51d6ba81d132169878f2389ea5bbb9d875d2d0103`.

Checks: `npm run build` passed (existing Vite chunk-size advisory); `npm test` **118/118**; `npm run test:browser` **32/32**; `node --test tests/browser/lighting.browser.mjs` **8/8**. Logs are in `ruling-cde29baf/`; the older `*-retune.log` files preserve the superseded assertion failure. The seeded review PNGs are 1280×720: seven full frames and water views, plus morning/day/sunset/night toward/away 4× crops. Reproduce with `LIGHTING_REVIEW_LABEL=after node tools/lighting-review.mjs`. `lookdev-before/` preserves the `bf8ac5f` frames and probe; the original `review-before-*` frames still represent main.

### Parity and comparison

The original EBR-73 Gate G baseline at `a61bac9` was not re-recorded. Earlier `npm run parity` and QA `compare-frames.py` runs reported changed lit frames, as expected from EBR-80 lighting and EBR-48 water; their logs are historical, not a claim of pixel parity for this revision. The bridge-route stairs/day poses differ from that older pre-water baseline. Do not re-baseline Gate G until Look Dev signs.

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
