#!/usr/bin/env python3
"""Compare fixed 1280x720 review frames on a common, void-free island mask."""
import json
import math
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

root = Path(__file__).resolve().parents[1] / 'evidence' / 'lighting'
before = root / 'lookdev-before'
rect = (300, 375, 450, 415)
background = (16, 20, 22)
phases = ('morning', 'daytime', 'sunset')
cases = ('morning-clear', 'daytime-clear', 'sunset-clear', 'night-clear',
         'night-rain', 'daytime-cloudy', 'daytime-rain')


def image(directory, phase):
    result = Image.open(directory / f'review-after-{phase}-clear-full.png').convert('RGB')
    if result.size != (1280, 720):
        raise ValueError(f'{phase}: expected a 1280x720 frame, got {result.size}')
    return result


reference = image(before, 'daytime')
mask = Image.new('L', reference.size)
mask.putdata([255 if i // reference.width >= 100 and pixel != background else 0
              for i, pixel in enumerate(reference.getdata())])


def luminance(rgb):
    return sum(channel * weight for channel, weight in zip(rgb, (0.2126, 0.7152, 0.0722)))


def measure(directory):
    result = {}
    for phase in phases:
        frame = image(directory, phase)
        result[phase] = {
            'grass_region_mean': luminance(ImageStat.Stat(frame.crop(rect)).mean),
            'island_mean': luminance(ImageStat.Stat(frame, mask).mean),
        }
    return result


def unchanged_regions():
    result = {}
    before_proof = json.loads((before / 'review-after.json').read_text())['cases']
    after_proof = json.loads((root / 'review-after.json').read_text())['cases']
    for case in cases:
        previous = Image.open(before / f'review-after-{case}-full.png').convert('RGB')
        current = Image.open(root / f'review-after-{case}-full.png').convert('RGB')
        hud = []
        for box in ((0, 0, 240, 90), (500, 0, 780, 90)):
            diff = ImageChops.difference(previous.crop(box), current.crop(box))
            hud.append(sum(pixel != (0, 0, 0) for pixel in diff.getdata()))
        old, new = before_proof[case], after_proof[case]
        assert hud == [0, 0], f'{case}: HUD changed'
        assert previous.getpixel((1200, 300)) == current.getpixel((1200, 300)) == background, f'{case}: void changed'
        assert all(old[key] == new[key] for key in ('color', 'character', 'camera', 'pixel', 'weather')), \
            f'{case}: key color, camera, weather or pixel pass changed'
        old_length = math.hypot(old['shadow'][0], old['shadow'][2])
        new_length = math.hypot(new['shadow'][0], new['shadow'][2])
        assert abs(old_length - new_length) < 1e-9, f'{case}: shadow length changed'
        key_length = math.hypot(new['light'][0], new['light'][2])
        cosine = -(new['shadow'][0] * new['light'][0] + new['shadow'][2] * new['light'][2]) / (new_length * key_length)
        assert cosine > 0.999999, f'{case}: shadow no longer points opposite the key'
        water = {}
        for name, point in {'pond': (837, 389), 'stream': (661, 450), 'waterfall': (526, 593)}.items():
            water[name] = {'before': previous.getpixel(point), 'after': current.getpixel(point)}
        result[case] = {'hud_changed_pixels': hud, 'void': background, 'same_color_camera_pixel_weather': True,
                        'shadow_length_before': old_length, 'shadow_length_after': new_length,
                        'shadow_opposite_key_cosine': cosine, 'water_samples': water}
    return result


print(json.dumps({
    'viewport': list(reference.size),
    'grass_region_xyxy': list(rect),
    'mask': 'bf8ac5f daytime non-#101416 pixels at y >= 100 (excludes HUD/void)',
    'mask_pixels': sum(1 for value in mask.getdata() if value),
    'luminance': '0.2126*R + 0.7152*G + 0.0722*B, 0-255 sRGB',
    'before_bf8ac5f': measure(before),
    'after': measure(root),
    'unchanged_regions': unchanged_regions(),
}, indent=2))
