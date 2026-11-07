#!/usr/bin/env python3
"""Isolate the signed animated waterfall from QA's fixed-camera stills.

This does not change the official C5 result: it reports whether any exact
pixel changes occur outside the visible waterfall at the 1280x720 spawn view.
"""
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops
from evidence_paths import output_directory

cases = ['morning-clear', 'day-clear', 'sunset-clear', 'night-clear', 'day-cloudy']
mask = (475, 510, 580, 700)  # Includes the projected +Z waterfall at the QA spawn camera.
results = {}
failed = False
for directory in map(Path, sys.argv[1:]):
    records = {}
    for case in cases:
        before = Image.open(directory / f'{case}-still-0.png').convert('RGB')
        checks = []
        for frame in [1, 2, 3]:
            after = Image.open(directory / f'{case}-still-{frame}.png').convert('RGB')
            difference = ImageChops.difference(before, after)
            changed = outside = 0
            for index, pixel in enumerate(difference.getdata()):
                if pixel == (0, 0, 0):
                    continue
                changed += 1
                x, y = index % before.width, index // before.width
                if not (mask[0] <= x < mask[2] and mask[1] <= y < mask[3]):
                    outside += 1
            checks.append({'frame': frame, 'changed': changed, 'outsideWaterfall': outside, 'bbox': difference.getbbox()})
            failed |= outside != 0
        records[case] = checks
        print(directory, case, checks)
    results[str(directory)] = records
output = output_directory('check-waterfall-motion')
output.mkdir(parents=True, exist_ok=True)
(output / 'waterfall-motion-proof.json').write_text(json.dumps({'mask': mask, 'results': results}, indent=2) + '\n')
raise SystemExit(1 if failed else 0)
