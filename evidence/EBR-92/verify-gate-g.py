#!/usr/bin/env python3
"""Check the body masks against the original, unmodified Gate G capture."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageChops

root = Path('evidence/EBR-92')
gate = root / 'gate-g-official'
baseline = json.loads((gate / 'baseline.json').read_text())
parity = json.loads((gate / 'parity.json').read_text())
assert baseline['sourceSha'] == parity['baselineSha'] == '5d9ba48f6bd9bfbc3974351b50d0ce89934380ff'
assert parity['stateMismatches'] == []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def diff(a, b):
    r, g, blue = ImageChops.difference(a.convert('RGB'), b.convert('RGB')).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), blue).point(lambda v: 255 if v else 0)


result = {}
for name in parity['results']:
    base = gate / 'baseline' / f'{name}.png'
    candidate = gate / 'candidate' / f'{name}.png'
    before = root / 'before' / 'gate-g' / f'{name}.png'
    after = root / 'after' / 'gate-g' / f'{name}.png'
    assert digest(base) == baseline['frames'][name]['sha256'] == digest(before), f'{name}: main hash mismatch'
    assert digest(candidate) == parity['frames'][name]['sha256'] == digest(after), f'{name}: candidate hash mismatch'
    changed = diff(Image.open(base), Image.open(candidate))
    allowed = Image.open(root / 'mask' / 'before-vs-after' / f'gate-g-{name}.png').convert('L')
    outside = ImageChops.subtract(changed, allowed).histogram()[255]
    hidden = diff(Image.open(root / 'before' / 'gate-g-bodyless' / f'{name}.png'),
                  Image.open(root / 'after' / 'gate-g-bodyless' / f'{name}.png')).histogram()[255]
    count = changed.histogram()[255]
    assert count == parity['results'][name]['changedPixels']
    assert outside == hidden == 0, f'{name}: changed pixels outside body or in body-hidden render'
    result[name] = {'changedPixels': count, 'bounds': changed.getbbox(), 'outsideBodyPixels': outside,
                    'bodylessChangedPixels': hidden, 'baselineSha256': digest(base), 'candidateSha256': digest(candidate)}
    print(f'{name}: {count} changed; outside body {outside}; bodyless {hidden}')
(gate / 'mask-verification.json').write_text(json.dumps(result, indent=2) + '\n')
