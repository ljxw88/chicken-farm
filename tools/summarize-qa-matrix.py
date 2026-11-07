#!/usr/bin/env python3
"""Save the QA v2.3 matrix's exact side/top, shade/lit and C4 definitions."""
import json
import math
import sys
from pathlib import Path
from PIL import Image
from evidence_paths import HISTORICAL

directory = Path(sys.argv[1]) if len(sys.argv) > 1 else HISTORICAL / 'lighting/qa-lookdev-rulings'
matrix = json.loads((directory / 'matrix.json').read_text())


def luma(pixel):
    return 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2]


def region(px, x0, x1, y0, y1):
    values = [luma(px[x, y]) for x in range(int(x0), int(x1)) for y in range(int(y0), int(y1))]
    return sum(values) / len(values)


def median(samples):
    return tuple(sorted(pixel[i] for pixel in samples)[len(samples) // 2] for i in range(3))


def median_region(image, center, radius):
    px = image.load()
    return median([px[int(center[0]) + dx, int(center[1]) + dy]
                   for dx in range(-radius, radius + 1) for dy in range(-radius, radius + 1)
                   if 0 <= int(center[0]) + dx < image.width and 0 <= int(center[1]) + dy < image.height])


def lab(color):
    def f(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    r, g, b = [(v / 255) ** 2.2 for v in color]
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def linear_luminance(color):
    return luma([(v / 255) ** 2.2 for v in color])


cases = {}
for name, case in matrix['cases'].items():
    a = case['away']
    bs = a['bodyScreen']
    cx, cy = bs['c']; r = bs['r']; hh = abs(bs['bot'][1] - bs['top'][1]) / 2
    image = Image.open(directory / f'{name}-crisp-away.png').convert('RGB')
    px = image.load()
    left = region(px, cx - 0.85*r, cx - 0.2*r, cy - 0.3*hh, cy + 0.3*hh)
    right = region(px, cx + 0.2*r, cx + 0.85*r, cy - 0.3*hh, cy + 0.3*hh)
    side = (left + right) / 2
    top = region(px, cx - 0.4*r, cx + 0.4*r, cy - 0.95*hh, cy - 0.7*hh)
    lit, shade = (left, right) if a['sun']['right'] < 0 else (right, left)
    body = median([px[int(cx + dx*r), int(cy + dy*hh)] for dx in (-0.5, 0, 0.5) for dy in (-0.5, -0.2, 0.2, 0.5)])
    ground_points = ((cx - 2.4*r, cy + 0.9*hh), (cx - 2.4*r, cy + 0.4*hh),
                     (cx - 1.6*r, cy + 1.35*hh), (cx - 0.3*r, cy + 1.6*hh),
                     (cx - 2.4*r, cy - 0.3*hh), (cx, cy - 1.8*hh))
    ground = median([px[int(max(0, min(1279, x))), int(max(0, min(719, y)))] for x, y in ground_points])
    lc, lg = linear_luminance(body), linear_luminance(ground)
    cases[name] = {'side_luminance': side, 'top_luminance': top, 'side_top': side / top,
                   'shade_luminance': shade, 'lit_luminance': lit, 'shade_lit': shade / lit,
                   'body_rgb': body, 'ground_rgb': ground,
                   'character_ground_contrast': (max(lc, lg) + 0.05) / (min(lc, lg) + 0.05),
                   'character_ground_delta_e_76': math.dist(lab(body), lab(ground))}
    if name.startswith('night-'):
        bs = case['pixel']['bodyScreen']; cx, cy = bs['c']; r = bs['r']; hh = abs(bs['bot'][1] - bs['top'][1]) / 2
        toward = Image.open(directory / f'{name}-crisp.png').convert('RGB').load()
        face = region(toward, cx - 0.5*r, cx + 0.5*r, cy - 0.25*hh, cy + 0.45*hh)
        crown = region(toward, cx - 0.4*r, cx + 0.4*r, cy - 0.95*hh, cy - 0.7*hh)
        cases[name].update({'toward_face_luminance': face, 'toward_key_top_luminance': crown, 'toward_face_top': face / crown})

samples = matrix['cases']['sunset-clear']['pixel']['samples']
sunset = Image.open(directory / 'sunset-clear-pixelpass.png').convert('RGB')
water = {name: median_region(sunset, samples[key], 3) for name, key in
         (('pond', 'pond2'), ('stream', 'stream2'), ('stream_downstream', 'stream4'), ('waterfall', 'fall2'))}
grass = median_region(sunset, samples['grass'], 6)
print(json.dumps({'source': str(directory), 'definitions': 'QA analyze-gate.py v2.3; crisp-away, 1280x720, gamma 2.2 / CIE76 C4',
                  'cases': cases, 'sunset_grass_rgb': grass, 'sunset_grass_g_over_r': grass[1] / grass[0],
                  'sunset_water_rgb': water}, indent=2))
