#!/usr/bin/env python3
"""Compare QA's gamma approximation with standard sRGB decoding for shade/grass CIE76."""
import json
import math
import sys
from pathlib import Path

source = Path(sys.argv[1] if len(sys.argv) > 1 else
              'evidence/lighting/ruling-cde29baf/detector/ruling-phase-gate.json')
samples = json.loads(source.read_text())


def lab(rgb, srgb):
    def decode(value):
        value /= 255
        if not srgb:
            return value ** 2.2  # The supplied QA analyzer's approximation.
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    r, g, b = map(decode, rgb)
    x = (0.4124*r + 0.3576*g + 0.1805*b) / 0.95047
    y = 0.2126*r + 0.7152*g + 0.0722*b
    z = (0.0193*r + 0.1192*g + 0.9505*b) / 1.08883
    f = lambda t: t ** (1/3) if t > 0.008856 else 7.787*t + 16/116
    return 116*f(y) - 16, 500*(f(x) - f(y)), 200*(f(y) - f(z))


result = {}
for name, sample in samples.items():
    shade, grass = sample['shadeRgb'], sample['grassReferenceRgb']
    result[name] = {'shade_rgb': shade, 'grass_rgb': grass,
                    'qa_gamma_2_2_delta_e_76': math.dist(lab(shade, False), lab(grass, False)),
                    'iec_srgb_delta_e_76': math.dist(lab(shade, True), lab(grass, True))}

print(json.dumps({'source': str(source), 'reference': 'D65; QA RGB-to-XYZ coefficients', 'cases': result}, indent=2))
