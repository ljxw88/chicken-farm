#!/usr/bin/env python3
"""Pair QA's full matrix with same-pose rain-hidden lighting captures.

Usage: python3 evidence/EBR-92/prepare-paired-qa.py before|after
The unmodified gfx-matrix frames are retained except for the crisp-away
measurement frames. Symlinks keep the original raw captures available too.
"""
import json
import os
import sys
from pathlib import Path

root = Path('evidence/EBR-92')
label = sys.argv[1]
assert label in ('before', 'after')
raw = root / f'matrix-{label}'
capture = root / label
paired = root / f'paired-{label}'
paired.mkdir(exist_ok=True)
matrix = json.loads((raw / 'matrix.json').read_text())
report = json.loads((capture / 'capture.json').read_text())
for name, case in matrix['cases'].items():
    sample = report['phases'][f'{name}-away']
    case['away']['bodyScreen'] = sample['bodyScreen']
    case['away']['char'] = sample['position']
    case['away']['sun']['right'] = sample['sunRight']
for source in raw.glob('*.png'):
    target = paired / source.name
    if source.name.endswith('-crisp-away.png'):
        name = source.name.removesuffix('-crisp-away.png')
        source = capture / 'crisp' / f'{name}-away.png'
    if target.is_symlink():
        target.unlink()
    assert not target.exists(), f'Unexpected existing output: {target}'
    target.symlink_to(os.path.relpath(source, paired))
matrix['pairedMeasurement'] = {'sourceSha': report.get('sourceSha'), 'capture': str(capture),
    'method': 'identical seeded time/pose, 0.2334 s W; weather active, rain particles hidden only for crisp-away'}
(paired / 'matrix.json').write_text(json.dumps(matrix, indent=1) + '\n')
print(f'Prepared {paired}: {len(matrix["cases"])} cases; unmodified QA analyzer can read this directory')
