#!/usr/bin/env python3
"""Verify QA Gate G against independent frozen visible-body masks."""
import hashlib
import json
import os
from pathlib import Path

from PIL import Image, ImageChops

root = Path('evidence/EBR-92')
out = Path(os.environ.get('EBR92_COMPARE_DIR', root / 'merge-6daf042'))
gate = Path(os.environ.get('EBR92_GATE_DIR', root / 'merge-6daf042' / 'gate-g'))
baseline = json.loads((gate / 'baseline.json').read_text())
parity = json.loads((gate / 'parity.json').read_text())
main = Path(os.environ.get('EBR92_MAIN_CAPTURE_DIR', root / 'main-6daf042'))
candidate = Path(os.environ.get('EBR92_CANDIDATE_DIR', root / 'merged-6daf042'))
main_state = json.loads((main / 'capture.json').read_text())
candidate_state = json.loads((candidate / 'capture.json').read_text())
assert baseline['sourceSha'] == parity['baselineSha'] == main_state['sourceSha'] == '6daf042ad85882f020268baf53fc92fb09e921ad'
assert candidate_state['sourceStatus'] == '', 'Candidate source/test/tool tree is not committed'
assert parity['stateMismatches'] == []
assert main_state['gate'] == candidate_state['gate'], 'Gate G state differs'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def diff(a, b):
    r, g, blue = ImageChops.difference(a.convert('RGB'), b.convert('RGB')).split()
    return ImageChops.lighter(ImageChops.lighter(r, g), blue).point(lambda v: 255 if v else 0)


(out / 'mask').mkdir(parents=True, exist_ok=True)
(out / 'body-diff').mkdir(exist_ok=True)
result = {}
for name in parity['results']:
    base = gate / 'baseline' / f'{name}.png'
    rendered = gate / 'candidate' / f'{name}.png'
    main_frame = main / 'gate-g' / f'{name}.png'
    final_frame = candidate / 'gate-g' / f'{name}.png'
    assert digest(base) == baseline['frames'][name]['sha256'] == digest(main_frame), f'{name}: main hash mismatch'
    assert digest(rendered) == parity['frames'][name]['sha256'] == digest(final_frame), f'{name}: candidate hash mismatch'
    original, final = Image.open(base), Image.open(rendered)
    main_hidden = Image.open(main / 'gate-g-bodyless' / f'{name}.png')
    final_hidden = Image.open(candidate / 'gate-g-bodyless' / f'{name}.png')
    mask = ImageChops.lighter(diff(original, main_hidden), diff(final, final_hidden))
    if name in ('night', 'cottage-coops-night'):
        mask = Image.new('L', mask.size)
    changed = diff(original, final)
    outside = ImageChops.subtract(changed, mask).histogram()[255]
    hidden = diff(main_hidden, final_hidden).histogram()[255]
    count = changed.histogram()[255]
    assert count == parity['results'][name]['changedPixels']
    assert outside == hidden == 0, f'{name}: changes outside body or in body-hidden render'
    if name in ('night', 'cottage-coops-night'):
        assert count == 0, f'{name}: night must match exactly'
    mask.save(out / 'mask' / f'{name}.png')
    black = Image.new('L', changed.size)
    Image.merge('RGB', (changed, black, changed)).save(out / 'body-diff' / f'{name}.png')
    result[name] = {'changedPixels': count, 'bounds': changed.getbbox(), 'allowedBounds': mask.getbbox(),
                    'outsideBodyPixels': outside, 'bodylessChangedPixels': hidden,
                    'baselineSha256': digest(base), 'candidateSha256': digest(rendered)}
    print(f'{name}: {count} changed, bbox {changed.getbbox()}, outside body {outside}, bodyless {hidden}')
(out / 'parity-verification.json').write_text(json.dumps({
    'baselineSha': baseline['sourceSha'], 'candidateSha': candidate_state['sourceSha'],
    'stateMismatches': parity['stateMismatches'], 'frames': result,
}, indent=2) + '\n')
