# EBR-80 ruling test evidence

The scene is unchanged from `a83c18a`; this follow-up removes the unruled night body/path C4 assertion. Build, unit, browser and standalone detector logs are saved here. QA's earlier raw G5 pad-origin failure remains in `../qa-lookdev-rulings/RESULT.txt`.

Test disposition: **DELETE** the independently unruled night body/path assertion. **KEEP** the shade-front/grass ΔE ≥25 check: Look Dev's supplied ruling specifies the threshold independently of the implementation; it detects a visible loss of color separation on the real rendered scene, through the existing seeded graphics probe. Its shade regions scale with the projected character, the grass reference is a median, and it adds no duplicate test or exact-image snapshot. The explicit visual-gate requirement governs this appearance check.

The gate retains QA's gamma-2.2 RGB decoding. `shade-deltae-methods.json` also records standard IEC sRGB decoding of the same samples; the two methods differ, particularly for night-cloudy and night-rain. Reproduce with `python3 tools/lighting-shade-deltae.py`.
