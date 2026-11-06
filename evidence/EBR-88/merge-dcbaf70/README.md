# EBR-88 after EBR-74 merge

The parent evidence at `evidence/EBR-88/` is the Look Dev-signed `6c3c03a` record and is not replaced. This directory compares the merged branch against both clean detached worktrees: new main `dcbaf70` and signed tip `6c3c03a`.

The merge had no textual conflicts. Git kept EBR-74's engine/controller and the signed rain implementation, updating only the rain files' moved `FarmObstacle` type imports. `RAIN_LOOK` remains byte-for-byte identical to the signed tip. The existing rain field continues to follow the player; Engineer did not add optional island-centre clipping because that would change the signed look. `tests/weather.test.mjs` additionally exercises engine-controlled movement and compares all streak endpoints against a stationary, identically seeded rain field, allowing only normal 19-unit wraps.

`weather-imports.patch` is the complete weather-source diff from the signed tip; it contains only the two moved type-import paths. Both versions of `rainSettings.ts` have Git blob `883e635d3a51ba107aee2b07d837c7bb95cd359d` and SHA-256 `da302529d67fa217e58fdc499699455c02176178a11d883afec4b28a7163a47b`.

`capture.mjs` serves each worktree in sequence with Chromium/SwiftShader, DPR 1, a 1280×720 viewport, seed `0xeb730001`, and the same fixed animation times used for the signed evidence. It verifies that the signed day/night recaptures exactly match the committed signed frames. The extra `day-rain-walk` case uses real keyboard input through each version's engine. It records exact RGBA diffs, rain-with-streaks-hidden frames, renderer state, console errors/warnings, field centres and geometry hashes in `comparison.json`.

For the new-main rain check, the mask is the union of each tree's actual full-versus-streak-hidden render, including any rain-dependent translucent-HUD backdrop pixels. It is not a hand-drawn region. Clear and cloudy must be exactly identical; stationary day/night rain must differ only within that streak mask. Signed-versus-merged results separately count full-frame, streak-mask and streak-colour differences.

## Results

- Build passed; `npm test` **134/134** and `npm run test:browser` **33/33** passed serially. `npm ci` was unnecessary: the lockfile was unchanged and `npm ls --depth=0` passed.
- Versus `dcbaf70`: clear **0**, cloudy **0** changed pixels; day rain **31,407** and night rain **31,442** raw, with **0** outside the streak masks. During the extra walking-rain frame, **31,968** raw pixels changed and **0** were outside the streak mask. With streaks hidden, all three rain comparisons are **0**.
- Versus signed `6c3c03a`: day rain **0**, night rain **0**, and walking rain **0** full-frame and streak-pixel differences; streak masks and geometry hashes also match exactly. The signed static captures match the previously committed signed PNG hashes. The walking rain field centre equals the engine-controlled character position `(1.806658, 2.4, 1.979899)`.
- The new-main Gate G baseline records `dcbaf70`. Its unmodified `npm run parity` reports zero for all seven non-rain scenarios, no state mismatches and the intended **31,407** day-rain pixels, so its all-zero assertion exits nonzero. `comparison.json` proves the rain pixels are streak-derived.
- HUD state is identical across all captures; console warnings/errors: **0**. Original signed PNGs remain unchanged. Source capture commit: `55b21463a0154b5ad35465c3e7fc128dbcefc882`; the later handoff commit only adds evidence and documentation.
- `SHA256SUMS.txt` covers this directory's PNGs; the parent directory's signed checksum list still verifies independently.

## Reproduce

With dependencies installed and the merged source committed, create two fresh, clean temporary worktrees and link the installed `node_modules`:

```sh
MAIN=/tmp/ebr88-main-dcbaf70-your-name
SIGNED=/tmp/ebr88-signed-6c3c03a-your-name
git worktree add --detach "$MAIN" dcbaf70b8f2c1038afe5c0b70f506ec7de931214
git worktree add --detach "$SIGNED" 6c3c03a6c5bfe12ad98de019f7abc757897680c4
ln -s "$PWD/node_modules" "$MAIN/node_modules"
ln -s "$PWD/node_modules" "$SIGNED/node_modules"
node evidence/EBR-88/merge-dcbaf70/capture.mjs "$MAIN" "$SIGNED"
PARITY_EVIDENCE_DIR=evidence/EBR-88/merge-dcbaf70/gate-g npm run parity -- --record-baseline --baseline-sha dcbaf70b8f2c1038afe5c0b70f506ec7de931214
PARITY_EVIDENCE_DIR=evidence/EBR-88/merge-dcbaf70/gate-g npm run parity
```

Run builds, tests and browser captures one at a time. The final parity command intentionally exits nonzero for the signed rain pixels. The generated files in this directory do not modify the application or the signed reference frames.
