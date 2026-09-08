"""
Generate Apple startup images for spiralout.

The supplied `spiralout-splash.png` cannot be used: its export baked in a darker
rectangle over roughly 13-65% of the canvas, so any crop or pad of it shows two
horizontal seams. This rebuilds the splash from the clean 2048x2048 mark, following
START_HERE.md: mark centred at 37% height with a circular mask, on the ground gradient
    radial-gradient(120% 80% at 50% 38%, #241A52 0%, #1A1140 46%, #120C2C 100%)
"""

import sys
from PIL import Image

MARK = sys.argv[1]
OUT_DIR = sys.argv[2]

# Gradient stops from Splash.dc.html.
STOPS = [(0.00, (0x24, 0x1A, 0x52)),
         (0.46, (0x1A, 0x11, 0x40)),
         (1.00, (0x12, 0x0C, 0x2C))]

SIZES = ["1320x2868", "1290x2796", "1206x2622", "1179x2556", "1284x2778",
         "1170x2532", "1242x2688", "1125x2436", "828x1792", "750x1334", "1242x2208"]


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sample(t):
    """Colour at normalised gradient distance t."""
    t = max(0.0, min(1.0, t))
    for i in range(len(STOPS) - 1):
        p0, c0 = STOPS[i]
        p1, c1 = STOPS[i + 1]
        if t <= p1:
            span = p1 - p0
            return lerp(c0, c1, 0.0 if span == 0 else (t - p0) / span)
    return STOPS[-1][1]


def ground(w, h):
    """
    radial-gradient(120% 80% at 50% 38%). CSS sizes the ellipse as a percentage of the
    box, so the radii are 0.60*w and 0.40*h, centred at (0.5w, 0.38h).
    Built small and upscaled — a smooth gradient loses nothing and it is ~100x faster.
    """
    sw, sh = max(2, w // 8), max(2, h // 8)
    img = Image.new("RGB", (sw, sh))
    px = img.load()
    cx, cy = 0.5 * sw, 0.38 * sh
    rx, ry = 0.60 * sw, 0.40 * sh
    for y in range(sh):
        dy = (y - cy) / ry
        for x in range(sw):
            dx = (x - cx) / rx
            px[x, y] = sample((dx * dx + dy * dy) ** 0.5)
    return img.resize((w, h), Image.LANCZOS)


def circular_alpha(size):
    """
    mask-image: radial-gradient(circle at 50% 50%, #000 50%, transparent 72%).
    Opaque to half the radius, then a linear fade to nothing at 72%.
    """
    m = Image.new("L", (size, size))
    px = m.load()
    c = size / 2.0
    for y in range(size):
        dy = (y - c) / c
        for x in range(size):
            d = ((x - c) / c * ((x - c) / c) + dy * dy) ** 0.5
            if d <= 0.50:
                px[x, y] = 255
            elif d >= 0.72:
                px[x, y] = 0
            else:
                px[x, y] = round(255 * (1 - (d - 0.50) / 0.22))
    return m


mark_src = Image.open(MARK).convert("RGB")
print(f"mark {mark_src.size}")

for dim in SIZES:
    w, h = (int(v) for v in dim.split("x"))
    canvas = ground(w, h)

    # The design draws the mark at 108% of viewport width, centred at 37% height.
    m = round(w * 1.08)
    mark = mark_src.resize((m, m), Image.LANCZOS)

    # The mark art is light-on-dark and the design composites it with
    # mix-blend-mode: screen. screen(a,b) = 255 - (255-a)(255-b)/255, which for dark
    # art on a dark ground keeps the glow and drops the black background entirely.
    tile = canvas.crop((0, 0, m, m)) if m <= min(w, h) else Image.new("RGB", (m, m), STOPS[1][1])
    box = (round(w / 2 - m / 2), round(h * 0.37 - m / 2))
    region = Image.new("RGB", (m, m), STOPS[1][1])
    # Take the actual ground under where the mark will land, so the blend is honest.
    region.paste(canvas.crop((box[0], box[1], box[0] + m, box[1] + m)).resize((m, m)), (0, 0))
    blended = Image.new("RGB", (m, m))
    bp, mp, rp = blended.load(), mark.load(), region.load()
    for y in range(m):
        for x in range(m):
            a, b = mp[x, y], rp[x, y]
            bp[x, y] = (255 - (255 - a[0]) * (255 - b[0]) // 255,
                        255 - (255 - a[1]) * (255 - b[1]) // 255,
                        255 - (255 - a[2]) * (255 - b[2]) // 255)

    canvas.paste(blended, box, circular_alpha(m))
    canvas.save(f"{OUT_DIR}/{dim}.jpg", "JPEG", quality=80, optimize=True, progressive=True)
    print(f"  {dim}")

print("done")
