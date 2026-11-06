#!/usr/bin/env python3
"""Compare unchanged HUD/void regions in seeded 1280x720 review frames."""
import json
from pathlib import Path
from PIL import Image, ImageChops

root = Path('evidence/lighting')
cases = ['morning-clear', 'daytime-clear', 'sunset-clear', 'night-clear',
         'night-rain', 'daytime-cloudy', 'daytime-rain']
panels = [(0, 0, 240, 90), (500, 0, 780, 90)]
results = {}
failed = False
for case in cases:
    before = Image.open(root / f'review-before-{case}-full.png').convert('RGB')
    after = Image.open(root / f'review-after-{case}-full.png').convert('RGB')
    assert before.size == after.size == (1280, 720), case
    counts = []
    for box in panels:
        difference = ImageChops.difference(before.crop(box), after.crop(box))
        counts.append(sum(pixel != (0, 0, 0) for pixel in difference.getdata()))
    void_before = before.getpixel((1200, 300))
    void_after = after.getpixel((1200, 300))
    ok = counts == [0, 0] and void_before == void_after == (16, 20, 22)
    results[case] = {'hudChangedPixels': counts, 'voidBefore': void_before, 'voidAfter': void_after, 'pass': ok}
    if case == 'sunset-clear':
        # Unobstructed, fixed-camera samples in the lit grass, pond, stream and
        # waterfall face. These are actual 4-CSS-px presentation pixels.
        points = {'grass': (418, 352), 'pond': (837, 389), 'stream': (661, 450), 'waterfall': (526, 593)}
        samples = {name: {'before': before.getpixel(point), 'after': after.getpixel(point)} for name, point in points.items()}
        grass = samples['grass']['after']
        water_ok = all(samples[name]['after'][2] > samples[name]['after'][0] + 5 for name in ['pond', 'stream', 'waterfall'])
        color_ok = grass[1] >= 1.25 * grass[0] and water_ok
        results[case]['sunsetSamples'] = samples
        results[case]['sunsetColorPass'] = color_ok
        failed |= not color_ok
        print('sunset samples:', samples, 'PASS' if color_ok else 'FAIL')
    if case in ['night-clear', 'night-rain']:
        points = {'roof': (620, 200), 'wall': (680, 260), 'coop-a': (740, 320), 'coop-b': (820, 320)}
        samples = {name: after.getpixel(point) for name, point in points.items()}
        luminance = lambda rgb: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
        differences = {name: luminance(rgb) - luminance(void_after) for name, rgb in samples.items()}
        readable = all(value > 8 for value in differences.values())
        results[case]['nightSamples'] = samples
        results[case]['nightLumaAboveVoid'] = differences
        results[case]['nightReadabilityPass'] = readable
        failed |= not readable
        print(case, 'luma above void:', {name: round(value, 1) for name, value in differences.items()}, 'PASS' if readable else 'FAIL')
    failed |= not ok
    print(f'{case}: HUD changed {counts}, void {void_before} -> {void_after} {"PASS" if ok else "FAIL"}')

for label in ['before', 'after']:
    review = json.loads((root / f'review-{label}.json').read_text())
    for case in cases:
        pixel = review['cases'][case]['pixel']
        ok = pixel['enabled'] and pixel['cssPixelSize'] == 4 and [pixel['canvasWidth'], pixel['canvasHeight']] == [320, 180]
        results[case][f'{label}PixelPass'] = ok
        failed |= not ok
(root / 'region-proof.json').write_text(json.dumps(results, indent=2) + '\n')
raise SystemExit(1 if failed else 0)
