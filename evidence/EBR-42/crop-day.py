#!/usr/bin/env python3
"""Make an unaltered, enlarged daytime chimney comparison from Gate G frames."""
import json
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent
report = json.loads((root / 'comparison.json').read_text())
x, y, width, height = report['crops']['chimney']
nearest = getattr(Image, 'Resampling', Image).NEAREST
for name, source in {
    'chimney-day-before': root / 'baseline/daytime-clear.png',
    'chimney-day-after': root / 'candidate/daytime-clear.png',
    'chimney-day-mask': root / 'mask/combined/daytime-clear.png',
}.items():
    with Image.open(source) as image:
        assert image.size == (1280, 720)
        image.crop((x, y, x + width, y + height)).resize(
            (width * 3, height * 3), nearest,
        ).save(root / 'crops' / f'{name}.png')
    print(f'{name}: ({x},{y},{width},{height}), 3x nearest-neighbour')
