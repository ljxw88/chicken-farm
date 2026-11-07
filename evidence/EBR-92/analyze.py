#!/usr/bin/env python3
"""Analyze frozen EBR-92 captures, including independent body masks and C4.

Usage: python3 evidence/EBR-92/analyze.py <label> [baseline-label]
The QA median metric is reproduced separately from the ticket's mean metric.
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

root = Path('evidence/EBR-92')
label = sys.argv[1]
baseline = sys.argv[2] if len(sys.argv) > 2 else None
folder = root / label
capture = json.loads((folder / 'capture.json').read_text())


def difference(a, b):
    d = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    r, g, blue = d.split()
    return ImageChops.lighter(ImageChops.lighter(r, g), blue).point(lambda v: 255 if v else 0)


def count(mask):
    return mask.histogram()[255]


def mean(image, mask):
    return ImageStat.Stat(image.convert('RGB'), mask).mean


def median(samples):
    return tuple(sorted(pixel[i] for pixel in samples)[len(samples) // 2] for i in range(3))


def luminance(c):
    r, g, b = [(v / 255) ** 2.2 for v in c]
    return 0.2126*r + 0.7152*g + 0.0722*b


def lab(c):
    r, g, b = [(v / 255) ** 2.2 for v in c]
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787*t + 16/116
    x = f((0.4124*r + 0.3576*g + 0.1805*b) / 0.95047)
    y = f(0.2126*r + 0.7152*g + 0.0722*b)
    z = f((0.0193*r + 0.1192*g + 0.9505*b) / 1.08883)
    return (116*y - 16, 500*(x-y), 200*(y-z))


def lab_exact(c):
    def linear(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = [linear(v) for v in c]
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787*t + 16/116
    x = f((0.4124*r + 0.3576*g + 0.1805*b) / 0.95047)
    y = f(0.2126*r + 0.7152*g + 0.0722*b)
    z = f((0.0193*r + 0.1192*g + 0.9505*b) / 1.08883)
    return (116*y - 16, 500*(x-y), 200*(y-z))


def contrast(body, ground):
    a, b = luminance(body), luminance(ground)
    return {'ratio': (max(a, b) + 0.05) / (min(a, b) + 0.05), 'deltaE76': math.dist(lab(body), lab(ground))}


def region(px, x0, x1, y0, y1):
    vals = [0.2126*px[x, y][0] + 0.7152*px[x, y][1] + 0.0722*px[x, y][2]
            for x in range(int(x0), int(x1)) for y in range(int(y0), int(y1))]
    return sum(vals) / len(vals)


metrics = {}
mask_dir = root / 'mask' / label
mask_dir.mkdir(parents=True, exist_ok=True)
crop_dir = root / 'crops'
crop_dir.mkdir(exist_ok=True)
for name, info in capture['phases'].items():
    im = Image.open(folder / 'crisp' / f'{name}.png').convert('RGB')
    hidden = Image.open(folder / 'crisp-bodyless' / f'{name}.png').convert('RGB')
    body_mask = difference(im, hidden)
    assert count(body_mask) > 100, f'{name}: empty body mask'
    px = im.load()
    ground = [px[p['x'], p['y']] for p in info['groundSamples']]
    ground_mean = [sum(p[i] for p in ground) / len(ground) for i in range(3)]
    body_mean = mean(im, body_mask)
    bs = info['bodyScreen']
    cx, cy = bs['c']; r = bs['r']; hh = abs(bs['bot'][1] - bs['top'][1]) / 2
    body_median = median([px[int(cx + dx*r), int(cy + dy*hh)]
                          for dx in (-0.5, 0, 0.5) for dy in (-0.5, -0.2, 0.2, 0.5)])
    ground_points = [(cx-2.4*r, cy+hh*0.9), (cx-2.4*r, cy+hh*0.4),
                     (cx-1.6*r, cy+hh*1.35), (cx-0.3*r, cy+hh*1.6),
                     (cx-2.4*r, cy-hh*0.3), (cx, cy-hh*1.8)]
    ground_median = median([px[int(max(0, min(1279, x))), int(max(0, min(719, y)))]
                            for x, y in ground_points])
    left = region(px, cx-0.85*r, cx-0.2*r, cy-0.3*hh, cy+0.3*hh)
    right = region(px, cx+0.2*r, cx+0.85*r, cy-0.3*hh, cy+0.3*hh)
    lit, shade = (left, right) if info['sunRight'] < 0 else (right, left)
    x0, x1 = (cx+0.2*r, cx+0.85*r) if info['sunRight'] < 0 else (cx-0.85*r, cx-0.2*r)
    shade_pixels = [px[x, y] for x in range(int(x0), int(x1)) for y in range(int(cy-0.3*hh), int(cy+0.3*hh))]
    shade_rgb = [sum(p[i] for p in shade_pixels) / len(shade_pixels) for i in range(3)]
    ring = [px[int(max(0, min(1279, cx+dx*r))), int(max(0, min(719, cy+dy*hh)))]
            for dx in (-3.4, -2.8, -2.2, 2.6, 3.2) for dy in (-1.6, -0.8, 0.0, 0.9, 1.5)]
    grass = [p for p in ring if p[1] > p[0]*1.05 and p[1] >= p[2]]
    assert len(grass) >= 4, f'{name}: too few K1 grass samples'
    grass_rgb = median(grass)
    surfaces = {}
    for p in info['groundSamples']:
        surfaces[p['surface']] = surfaces.get(p['surface'], 0) + 1
    metrics[name] = {
        'mean': {'bodyRGB': body_mean, 'groundRGB': ground_mean, 'bodyPixels': count(body_mask),
                 'groundSamples': len(ground), 'surfaces': surfaces, **contrast(body_mean, ground_mean)},
        'qaMedian': {'bodyRGB': body_median, 'groundRGB': ground_median, **contrast(body_median, ground_median)},
        'shadeLit': {'shade': shade, 'lit': lit, 'ratio': shade / lit},
        'qaK1': {'shadeRGB': shade_rgb, 'grassRGB': grass_rgb,
                 'deltaE22': math.dist(lab(shade_rgb), lab(grass_rgb)),
                 'deltaEExact': math.dist(lab_exact(shade_rgb), lab_exact(grass_rgb))},
        'weather': info['weather'], 'bodyHex': info['bodyHex'], 'position': info['position'], 'yaw': info['yaw'],
    }
    # These masks are independently obtained by hiding only the body mesh at
    # unchanged state/time; no before/after difference is used to construct them.
    frame = Image.open(folder / 'frames' / f'{name}.png').convert('RGB')
    bodyless = Image.open(folder / 'bodyless' / f'{name}.png').convert('RGB')
    difference(frame, bodyless).save(mask_dir / f'{name}.png')
    if name.split('-')[0] in ('daytime', 'sunset', 'night') and '-clear-' in name:
        x0, y0 = round(cx) - 64, round(cy) - 56
        crop = frame.crop((x0, y0, x0 + 128, y0 + 112))
        crop.resize((448, 392), Image.Resampling.NEAREST).save(crop_dir / f'{label}-{name}-3.5x.png')

(folder / 'metrics.json').write_text(json.dumps(metrics, indent=2) + '\n')
for name in ('daytime-clear-away', 'daytime-cloudy-away', 'daytime-rain-away'):
    m = metrics[name]
    print(f"{label} {name}: mean {m['mean']['ratio']:.4f}/dE {m['mean']['deltaE76']:.2f}; "
          f"QA median {m['qaMedian']['ratio']:.4f}/dE {m['qaMedian']['deltaE76']:.2f}; "
          f"shade/lit {m['shadeLit']['ratio']:.4f}; K1 exact dE {m['qaK1']['deltaEExact']:.3f}")

if baseline:
    before = root / baseline
    before_capture = json.loads((before / 'capture.json').read_text())
    results = {}
    mask_out = root / 'mask' / f'{baseline}-vs-{label}'
    diff_out = root / f'diff-{baseline}-vs-{label}'
    mask_out.mkdir(parents=True, exist_ok=True)
    diff_out.mkdir(exist_ok=True)
    for group, hidden_group in [('gate-g', 'gate-g-bodyless'), ('frames', 'bodyless')]:
        for source in sorted((before / group).glob('*.png')):
            target = folder / group / source.name
            original = Image.open(source).convert('RGB')
            candidate = Image.open(target).convert('RGB')
            before_hidden = Image.open(before / hidden_group / source.name).convert('RGB')
            after_hidden = Image.open(folder / hidden_group / source.name).convert('RGB')
            before_mask = difference(original, before_hidden)
            after_mask = difference(candidate, after_hidden)
            allowed = ImageChops.lighter(before_mask, after_mask)
            # There is no allowed change at the three protected anchors, even
            # inside the character silhouette. Night Gate G frames are exact.
            protected = (group == 'gate-g' and source.stem in ('night', 'cottage-coops-night')) or (
                group == 'frames' and source.stem.startswith(('morning-', 'sunset-', 'night-')))
            if protected:
                allowed = Image.new('L', allowed.size)
            changed = difference(original, candidate)
            outside = ImageChops.subtract(changed, allowed)
            hidden_changed = difference(before_hidden, after_hidden)
            name = f'{group}-{source.stem}'
            allowed.save(mask_out / f'{name}.png')
            zero = Image.new('L', changed.size)
            Image.merge('RGB', (changed, zero, changed)).save(diff_out / f'{name}.png')
            results[name] = {'changedPixels': count(changed), 'changedBounds': changed.getbbox(),
                             'allowedBounds': allowed.getbbox(), 'outsideBodyMask': count(outside),
                             'bodylessChangedPixels': count(hidden_changed)}
    state_mismatches = [name for name in capture['gate'] if capture['gate'][name] != before_capture['gate'][name]]
    comparison = {'baseline': baseline, 'candidate': label, 'stateMismatches': state_mismatches, 'frames': results}
    (root / f'comparison-{baseline}-vs-{label}.json').write_text(json.dumps(comparison, indent=2) + '\n')
    for name, item in results.items():
        print(f"{name}: {item['changedPixels']} changed, bbox {item['changedBounds']}, "
              f"outside mask {item['outsideBodyMask']}, bodyless {item['bodylessChangedPixels']}")
    assert not state_mismatches, f'Gate G state mismatch: {state_mismatches}'
    assert all(item['outsideBodyMask'] == 0 for item in results.values()), 'Pixels changed outside the body masks'
    assert all(item['bodylessChangedPixels'] == 0 for item in results.values()), 'Body-hidden frames differ'
