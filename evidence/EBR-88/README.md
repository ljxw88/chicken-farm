# EBR-88 rain evidence

- `before/` is from a clean detached main worktree at `9e8c8c6`; `after/` is the committed rain implementation. The full frames are 1280×720, DPR 1, Chromium/SwiftShader, with the normal pixel pass and HUD. Day/night rain uses the same seed and 2.5-second stepped animation as Gate G.
- `crops/` contains 4× nearest-neighbour crops from the actual day/night frames: grass `(300,300,180,110)` and roof `(548,168,155,110)` in CSS pixels.
- `gate-g/` holds the supplied QA main baseline, the ordinary `npm run parity` candidate and its diffs. The unmodified checker exits nonzero for the intentional rain change because it requires every frame to be identical.
- `comparison.json` records a separate main-versus-candidate clear/cloudy comparison, rain mask counts, isolated HUD comparisons, browser console results, and camera-follow measurements. `diff/` contains exact raw diffs, actual rain-effect masks, and diffs outside those masks. Surface pixel counts within the two crops use simple colour heuristics; the crops themselves are the visual evidence.
- `SHA256SUMS.txt` covers every evidence PNG; run `sha256sum -c SHA256SUMS.txt` from this directory.

Results: clear **0** changed pixels; cloudy **0**; day rain **31,407** raw and **0** outside the streak mask; night rain **31,442** raw and **0** outside the streak mask. Hiding all streaks gives 0 differences in these seeded frames. HUD-only pixels and DOM/layout are identical, while the translucent HUD's raw composite contains 1,291/1,326 changed pixels in day/night rain because the rain behind it changed. Console warnings/errors: 0.

The rain mask is the union of rendered changes from hiding the streaks and then the entire rain root, on each tree at the *same frame*. It includes splash impacts and any rain-dependent HUD backdrop blur, rather than hiding a hand-drawn screen region. The `no-streaks` frames expose splash differences separately; `no-rain` frames check the underlying scene. The `hud-only` captures hide the canvas temporarily, isolating the unchanged HTML HUD; raw differences within the translucent HUD bounds are counted separately. Full rain frames remain unmodified.

Camera-follow evidence checks both endpoints of all 240 streaks over 20 zero-time anchor moves, allowing only normal field-edge wraps. The rain-only `follow/` images also compare a camera shift of one low-resolution pixel (four CSS pixels) after translating the reference image. This is an automated motion check, not independent Look Dev approval.

An unmasked lighting-probe run intermittently failed its sunset shade/lit threshold when a foreground streak crossed the sampled character; its log is retained. In `lighting-occlusion.json`, 15 of 120 same-pose, native-resolution frames fall below the 0.75 ratio (minimum 0.7213), while all paired frames with particles hidden measure 0.77236. The browser suite now opts into `LIGHTING_PROBE_MASK_RAIN=1` for that lighting-only measurement, preserving rain weather and every threshold. Two isolated reruns are in `lighting-mask-*.log`; full visual frames above do not use this mask.

## Reproduce

Use `npm ci` in the candidate worktree and a clean temporary detached worktree for main. Link the candidate's `node_modules` into the temporary main worktree. Copy `baseline.json` and `baseline/` from `/home/michael/OpenBot/Shared/qa-graphics-gate/gate-g-baseline-9e8c8c6/` into `evidence/EBR-88/gate-g/`. With the candidate source committed:

```sh
BASE=/tmp/ebr88-main-your-name
git worktree add --detach "$BASE" 9e8c8c6c479567fcb4c7796763e86ceb6d6b72a4
ln -s "$PWD/node_modules" "$BASE/node_modules"
PARITY_EVIDENCE_DIR=evidence/EBR-88/gate-g npm run parity
node evidence/EBR-88/capture.mjs "$BASE"
node evidence/EBR-88/lighting-occlusion.mjs
```

The parity command intentionally reports the raw rain difference. The capture script asserts the clear/cloudy, streak-masked, no-rain, isolated-HUD and camera-follow checks, verifies the daytime reference hashes against Gate G, and generates the crops. The final diagnostic compares the same native-resolution sunset character frames with and without rain particles. None changes production code.
