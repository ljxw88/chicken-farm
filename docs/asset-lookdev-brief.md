# Asset Brief (Look Dev) — style rules, priority list, signing rubric

Owner: Look Dev. Date: 2026-11-06. For: Engineer / OpenCode (`worktrees/assetgen`, EBR-83..86), QA (asset section of EBR-81).
All numbers here are **design values**, not measurements from the Daniil frames. Look Dev can retune any of them in writing.
Engineer's draft `docs/asset-style-bible.md` is good and stays the machine contract. **Where it differs from this brief, this brief wins** (corrections in section 6).
This supersedes the format-specific parts of `ASSET-FORGE-LOOKDEV.md` (recipes). Output format (module or GLB) is Engineer's call. The look rules below do not depend on it.
Reference read: Daniil frame `a46b3e57…png` (pinned) plus signed EBR-46/47/56 frames in the repo.

## 1. Style rules to enforce

### 1.1 Pixel-pass math (so "visible" is measurable)
View height is 20 world units rendered at 180 px, so **1 world unit = 9 px** at the pixel-pass resolution (320×180, each pixel shown as 4 CSS px).
- 0.11 units = 1 px (the floor; anything thinner is invisible or shimmers).
- 0.2 units = 2 px (a feature meant to be seen).
- 0.3 units = 2.7 px (a part that must read as its own shape, such as a handle, a window or a wheel).

### 1.2 Silhouette and chunkiness
1. Silhouette first. The asset must be recognisable as a **solid black shape at 320×180**, in the game isometric view and from the front and side.
2. Chunky, toy-like, slightly rounded. 3–6 major masses per asset. Prefer exaggerated proportions to fine detail.
3. Thinnest solid dimension ≥ **0.1** (rails and planks may be 0.1 thick if they are ≥ 0.13 tall or wide). Cleats, bands and twine may be 0.1 wide. Nothing is thinner than 0.1 anywhere.
4. Every part meant to read has a smallest dimension ≥ **0.2**; handles, wheels, windows and hats ≥ **0.3** in at least two dimensions.
5. Slight hand-made irregularity (a leaning post, a rotated plank, an uneven crown). Seeded and deterministic. Keep it ≤ ~0.03 units and ≤ ~5° so it reads as charm, not damage.
6. Round things use 6–8 segments. Smooth, high-segment spheres and cylinders are rejected as "plastic".

### 1.3 Faceting, shading and tones
- Flat shading, matte (`roughness` 1). No textures, gradients, normal maps, noise, text or alpha cards.
- Each material family uses **at most 3 albedo tones**: base, a lighter tone for tops and edges, and a darker tone for undersides and trim. The scene lights add the lit/shade split on top.
- Never bake light direction or shadow into the colours. The key light is fixed (EBR-80): from screen upper-left, slightly behind. The asset must not fight it.
- **No outline.** The game has no outline today (EBR-53 may add a post-process one). Do not fake outlines with black meshes or back faces. Separate shapes by value and hue instead.
- No shadow maps, no lights and no cast-shadow tricks inside an asset. Ground contact shadow is added by the game as an offset blob.

### 1.4 Palette families
Use palette keys, not hex literals. Allowed families:
- **Greens:** foliage dark / mid / light, grass.
- **Warm woods and soil:** barn wood, coop wall, trim, door, trunk, dirt, dirt edge, dirt highlight, timber.
- **Rust roofs:** roof, shingle.
- **Cream:** plaster.
- **Warm stone:** `building.stone`.
- **Water:** pond water, rim, deep. Glass.

**Approved extension tokens** (design values; all other additions need written Look Dev approval):
| token | hex | use |
|---|---|---|
| `flower.red` | 0xc75b46 | flowers, mushroom caps, berries (existing comb colour) |
| `flower.yellow` | 0xf2c94c | flowers |
| `flower.blue` | 0x6a8fd0 | flowers (small clusters only) |
| `flower.orange` | 0xe08a3c | flowers, small mushrooms |
| `pumpkin` | 0xd9822b | pumpkins |
| `wool` | 0xf3ead6 | sheep wool, hat band, sack |
| `metal` | 0x554433 | axe head, bucket hoops, wheel rim, lantern frame (existing lantern metal) |
| `lantern.glow` | 0xffb060 | lantern glass only (see below) |
Mushroom stems and sacks reuse `plaster`. Straw reuses `dirt highlight`.

**Forbidden hues:** pure black, pure white, grey-blue (except stone, glass and water), saturated blue, purple, magenta or cyan, neon or acid green, chrome and metallic sheen, and any hue that makes the asset glow or look wet. The sole emissive is `lantern.glow`, declared on the lantern glass, ramped by the existing night amount, with no PointLight.

### 1.5 Worn vs clean
**Lightly weathered, never dirty.** Clean, readable forms plus 1–2 wear cues per asset: a lighter edge band, one darker or patched plank, a chipped rock facet, a leaning post. No grime, cracks, rust textures, decals or moss textures. Moss is a `foliage dark` cap mesh.

### 1.6 Foliage and nature look (from the Daniil frame)
- Round trees: crowns are **clusters of 3–6 flat-shaded lobes** of varied size, in foliage mid/light/dark, with the lightest lobe on top-left. Not one smooth ball.
- Pines and firs: **3–4 stacked cones**, each slightly smaller, offset and rotated by a few degrees. Dark green family only.
- Bushes: 2–3 lobes, optionally 3–5 small `flower.red` berries (≥ 0.15).
- Rocks: faceted, warm-grey (`stone`), one lighter top facet, optional `foliage dark` moss cap.
- Flowers: chunky heads (≥ 0.15), stems short. One accent colour per patch, plus an optional second.
- Grass tufts: a few dark-green blades (≥ 0.11 wide), grouped. Grass blades are a big part of the reference's cozy look.

### 1.7 Scale relationships (world units, from the code)
| Reference | Size |
|---|---|
| Character | **about 1.4 high**, radius 0.4 (the draft says "roughly 1", which is wrong) |
| Tile | 1.5 |
| Placement fence | 1.4–1.47 wide, 0.95 high, posts 0.17 |
| Coop | 1.4 × 1.3 body, ridge about 1.95 |
| Cottage | 4.4 × 3.0 footprint, walls 2.0, ridge about 3.1, chimney about 3.6 |
| Existing tree | about 2.8 high (trunk radius 0.14–0.24) |
| Pond | 3.5 × 2.2 |

Expected heights: bucket 0.4 · barrel 1.0 · crate 0.7 · hay bale 0.6 · trough 0.5 · bench 0.8 · wheelbarrow 0.7 · well 1.6 · scarecrow 1.8 · lantern post 1.8 · mailbox 1.2 · sign post 1.3 · pumpkin 0.3–0.4 · flower patch 0.3 · rock 0.3–0.8 · stump 0.5 · bush 0.7 · oak 2.6–3.6 · pine 3–4.2.

### 1.8 Placement hygiene
Origin at base centre, +Y up, front toward +Z. Nothing below y = −0.01. Centre the *visible* bounds on X and Z. Overlap solid parts instead of placing two faces in the same plane. Avoid tiny floating ornaments. Do not bury geometry in the ground to hide mistakes.

## 2. Priority list

Tiers are the order in which Look Dev wants to see them. P0 is the calibration set. If P0 looks wrong, stop and fix the style rules before generating the rest.

**P0, calibration (6):** oak round tree (2 variants) · bush · rock (3 variants) · barrel · crate · hay bale.
**P1, reference look (10):** **pine/fir tree (2 variants, must have, it frames the Daniil scene)** · **grass tuft cluster (must have)** · flower patches (3 colourways) · stump · **fallen log (must have, visible in the reference)** · fence post / rail / gate (must match the signed placement fence) · trough · wheelbarrow · lantern post · sign post.
**P2, character props (rest of Engineer's list):** bucket · stump with axe · mushrooms (red cap and orange) · pumpkins · well · scarecrow · bench · mailbox.
**P3, optional, add if time allows:** **stepping stones** (flat peach-tan stones in a loose path, in the reference) · window flower box · small wooden beehives (reference has them, small boxes with a darker green gable roof) · crop bed with seedling rows (do not replace the placement plot yet; plot colour is deferred to EBR-49).

Order inside a tier is Engineer's call. Variants count as the same asset id family (`...-a`, `...-b`), generated from different seeds. They must not be copies.

**Must NOT include:**
- eggs, feed sacks, coins, gems, inventory icons, market stalls, signs with readable text
- humans or NPCs
- vehicles, modern or industrial objects, glass bottles
- anything shiny or metallic-looking
- new buildings (the signed cottage and coops are final) and any water, stream, bridge or waterfall (EBR-48)
- any asset that needs a texture, transparency (other than the ghost system), or a PointLight
- a fence that differs from the signed fence

## 3. Signing rubric (what I look at, asset by asset)

I judge each shipped asset on its contact sheet (turntable, 3 lights) and in the showcase **beside the cottage, a coop, the fence, a tree and the character**.
Each axis is scored 1–5. **SIGNED needs every axis ≥ 4 and no REJECT reason.** Otherwise I return named changes.

| Axis | 5 looks like | Auto-fail if |
|---|---|---|
| Silhouette | recognisable at 320×180 as a solid shape, from front and side | unreadable at pixel-pass size; reads as a different object |
| Shape language | chunky, toy-like, faceted; matches the cottage, coops and trees | smooth, plastic, spiky, over-detailed, or realistic |
| Palette | only palette keys and approved tokens; warm, cozy | any forbidden hue; raw hex; glow without a declared source |
| Value structure | lit top / mid side / dark underside under the game key light | flat, or lit side on the wrong side, or too dark to read |
| Scale and fit | correct against character, fence and cottage; sits on the ground | wrong by more than ~25% of the table in 1.7; floating or buried |
| Craft | clean joins, no flicker, no gaps, no tiny floaters, 1–2 wear cues | z-fighting, holes, parts thinner than 0.1, unconnected parts |

### REJECT reasons (any one rejects the asset)
1. Off-palette colour, or a forbidden hue.
2. Looks like a different art style next to the signed cottage, coops, fence and trees (this is the most common failure and the one automation misses).
3. Detail that disappears at the pixel pass, or a silhouette that is only readable when zoomed in.
4. Smooth organic geometry, plastic spheres, or a realistic model.
5. Floating, buried or overlapping parts that read as a mistake.
6. Over budget (triangles, colours) or any hard check failing. A numerically passing asset can still be rejected by eye.
7. Shading that contradicts the key light (a front-lit face that should be in shade).
8. A baked outline, text, decal or texture.
9. Wrong scale against the table in 1.7.
10. A copy of another asset with a different colour (variants must differ in silhouette).

### Review conditions
- **Geometry and silhouette sign-off** can happen now.
- **Final style sign-off** (value structure and the lighting axes) waits for EBR-80 to merge. I will not sign shading under today's lights.
- **Night:** an asset must not glow. Only the lantern post glass may be lit at night. Everything else must stay readable against the void and ground by value alone.
- If the critic or the checks say PASS and my eye says no, the asset is REJECTED. The automated gates are a floor, not an approval.

## 4. How the loop should use this
- Feed this brief and the rubric to the generator and to the critic. The critic must be a separate session with the same rubric and the reference images.
- Give both the five or six signed in-game assets (cottage, coop, fence, tree, stairs) as the **style anchors**. Also give a few **anti-examples**: a smooth sphere tree, a spiky low-poly rock, an off-palette barrel. These make rejections concrete.
- Soft pass on first sight of the P0 set: I review P0 alone before P1 is generated. If P0 is rejected, adjust the brief, not just the assets.

## 5. Contact sheet / showcase requirements for READY
- Per asset: turntable of 8 yaws at the game isometric camera, pixel pass ON, nearest-neighbour 3× crops, in daytime, sunset and night. Plus one pixel-pass-OFF view for debugging.
- A silhouette view (flat black on the grass/path colours) at 320×180.
- A scale composite: the asset beside the character, the fence, a coop and the cottage.
- Showcase page `assets.html` on :5185: all assets on the island, orbit, day/sunset/night. Show which ones are P0/P1/P2 and which are `needs-human` or REJECTED.
- Report per asset: tri count, colours used, bbox, every check result, and the critic scores.

## 6. Corrections to Engineer's draft style bible (apply these)
1. **Character height is about 1.4**, not "roughly 1".
2. **Minimum detail is 0.1**, not 0.05. 0.05 is half a pixel at 320×180. Use the 0.1 / 0.2 / 0.3 ladder in 1.2 and set the legibility check to fail on anything under 0.1.
3. **Palette extensions are approved** for the eight tokens in 1.4. "None approved" in the draft is out of date. Anything else still needs written approval.
4. **One emissive is allowed:** the lantern post glass, `lantern.glow`, declared and night-ramped. No PointLight. Everything else is non-emissive.
5. **No outline.** Add it to the "what not to do" list.
6. Add the rubric REJECT reasons in section 3 to the verifier's critique prompt.
7. Add the new P1/P3 must-haves from section 2: fallen log, grass tufts, pine/fir, stepping stones.

## 7. Not decided / not measured
Per-asset pixel counts at 320×180, whether the critic model can see images, final triangle budgets after profiling, animal assets (hen, sheep) and animation (out of scope for this bundle, parked for EBR-70), and final style sign-off under the EBR-80 lighting.
