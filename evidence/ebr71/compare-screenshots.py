from pathlib import Path

from PIL import Image, ImageChops

root = Path(__file__).parent
pairs = [
    ('main-daytime-without-sim-ui.png', 'stripped-daytime.png'),
    ('main-night-without-sim-ui.png', 'stripped-night.png'),
    ('main-day-walk-without-sim-ui.png', 'stripped-day-walk.png'),
]

for main_name, stripped_name in pairs:
    main = Image.open(root / main_name).convert('RGB')
    stripped = Image.open(root / stripped_name).convert('RGB')
    if main.size != stripped.size:
        raise SystemExit(f'{main_name}: viewport size differs')
    difference = ImageChops.difference(main, stripped)
    count = sum(1 for pixel in difference.getdata() if any(pixel))
    print(f'{main_name} vs {stripped_name}: {count} / {main.width * main.height} pixels differ')
    if count:
        raise SystemExit(1)
