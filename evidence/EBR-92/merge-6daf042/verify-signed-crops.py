#!/usr/bin/env python3
"""Compare the merged character crops against the signed 49c9569 captures."""
import hashlib
import json
import os
import subprocess
from pathlib import Path

from PIL import Image, ImageChops

root = Path('evidence/EBR-92')
out = Path(os.environ.get('EBR92_COMPARE_DIR', root / 'merge-6daf042'))
candidate = Path(os.environ.get('EBR92_CANDIDATE_DIR', root / 'merged-6daf042'))
signed = '49c956999cffff31868dc2d6f3b566fd78fa7b3c'
reference = json.loads((root / 'after' / 'capture.json').read_text())
merged = json.loads((candidate / 'capture.json').read_text())
assert merged['sourceStatus'] == '', 'Candidate source/test/tool tree is not committed'
# The signed evidence capture preceded an evidence-only and a handoff commit.
subprocess.run(['git', 'diff', '--quiet', reference['sourceSha'], signed, '--',
                'src', 'tests', 'tools', 'index.html', 'package.json', 'package-lock.json'], check=True)
subprocess.run(['git', 'diff', '--quiet', signed, merged['sourceSha'], '--',
                'src/character/createCharacter.ts'], check=True)
(out / 'signed-crop-diff').mkdir(parents=True, exist_ok=True)
(out / 'signed-crops').mkdir(exist_ok=True)
(out / 'merged-crops').mkdir(exist_ok=True)


def difference(a, b):
    r, g, blue = ImageChops.difference(a.convert('RGB'), b.convert('RGB')).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), blue).point(lambda v: 255 if v else 0)


frames = {}
failures = []
for name in sorted(reference['phases']):
    before = reference['phases'][name]
    after = merged['phases'][name]
    for key in ('position', 'yaw', 'weather'):
        assert before[key] == after[key], f'{name}: {key} differs'
    a = root / 'after' / 'frames' / f'{name}.png'
    b = candidate / 'frames' / f'{name}.png'
    original, current = Image.open(a), Image.open(b)
    assert original.size == current.size == (1280, 720)
    changed = difference(original, current)
    count = changed.histogram()[255]
    frames[name] = {'changedPixels': count, 'bounds': changed.getbbox()}
    print(f'frame {name}: {count} changed pixels')
    if count:
        failures.append(f'frame {name}: {count}')

crops = {}
for phase, weather in (('daytime', 'clear'), ('daytime', 'cloudy'), ('daytime', 'rain'),
                       ('sunset', 'clear'), ('night', 'clear')):
    for facing in ('toward', 'away'):
        name = f'{phase}-{weather}-{facing}'
        cx, cy = reference['phases'][name]['bodyScreen']['c']
        x0, y0 = round(cx) - 64, round(cy) - 56
        box = (x0, y0, x0 + 128, y0 + 112)
        original = Image.open(root / 'after' / 'frames' / f'{name}.png').convert('RGB').crop(box)
        current = Image.open(candidate / 'frames' / f'{name}.png').convert('RGB').crop(box)
        original = original.resize((448, 392), Image.Resampling.NEAREST)
        current = current.resize((448, 392), Image.Resampling.NEAREST)
        a = out / 'signed-crops' / f'{name}.png'
        b = out / 'merged-crops' / f'{name}.png'
        original.save(a)
        current.save(b)
        # The six original signed clear crops were already committed; prove
        # the regenerated crop is the same before comparing the merge.
        if weather == 'clear':
            prior = Image.open(root / 'crops' / f'after-{name}-3.5x.png').convert('RGB')
            assert not difference(prior, original).getbbox(), f'{name}: does not match signed crop'
        assert original.size == current.size == (448, 392)
        changed = difference(original, current)
        count = changed.histogram()[255]
        blank = Image.new('L', changed.size)
        Image.merge('RGB', (changed, blank, changed)).save(out / 'signed-crop-diff' / f'{name}.png')
        crops[name] = {'changedPixels': count, 'bounds': changed.getbbox(),
                       'signedSha256': hashlib.sha256(a.read_bytes()).hexdigest(),
                       'mergedSha256': hashlib.sha256(b.read_bytes()).hexdigest()}
        print(f'crop {name}: {count} changed pixels')
        if count:
            failures.append(f'crop {name}: {count}')
(out / 'signed-crop-comparison.json').write_text(json.dumps({
    'signedSha': signed, 'referenceCaptureSha': reference['sourceSha'], 'mergedSha': merged['sourceSha'],
    'frameSize': [1280, 720], 'cropSize': [448, 392], 'scale': 3.5, 'frames': frames, 'crops': crops,
}, indent=2) + '\n')
assert not failures, f'Signed frames or crops changed: {failures}'
