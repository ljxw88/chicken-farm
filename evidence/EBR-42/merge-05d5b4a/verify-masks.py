import json
import sys
from functools import reduce
from pathlib import Path

from PIL import Image, ImageChops


root = Path(sys.argv[1] if len(sys.argv) > 1 else 'evidence/EBR-42/merge-05d5b4a/qa-gate')
report = json.loads((root / 'parity.json').read_text())


def difference(left, right):
    channels = ImageChops.difference(left.convert('RGBA'), right.convert('RGBA')).split()
    return reduce(ImageChops.lighter, channels).point(lambda value: 255 if value else 0)


def count(mask):
    return mask.histogram()[255]


for name, expected in report['frames'].items():
    image = lambda directory: Image.open(root / directory / f'{name}.png')
    baseline, candidate = image('baseline'), image('candidate')
    no_smoke, no_fireflies, no_effects = image('no-smoke'), image('no-fireflies'), image('no-effects')
    raw = difference(baseline, candidate)
    smoke = difference(candidate, no_smoke)
    fireflies = difference(candidate, no_fireflies)
    individual = ImageChops.lighter(smoke, fireflies)
    interaction = ImageChops.subtract(difference(candidate, no_effects), individual)
    allowed = ImageChops.lighter(individual, interaction)
    assert count(raw) == expected['changedPixels'], name
    assert count(smoke) == expected['smoke']['changed'], name
    assert count(fireflies) == expected['fireflies']['changed'], name
    assert count(interaction) == expected['interactionPixels'], name
    assert count(ImageChops.subtract(raw, allowed)) == 0, name
    assert count(difference(baseline, no_effects)) == 0, name
    for directory, actual in [('mask/smoke', smoke), ('mask/fireflies', fireflies), ('mask/combined', allowed)]:
        assert ImageChops.difference(image(directory).convert('L'), actual).getbbox() is None, f'{name}: {directory}'
    print(f'{name}: {count(raw)} changed, 0 outside exact masks, 0 with effects hidden')

assert len(report['frames']) == 8
print('Independent mask verification PASS: 8/8 frames')
