# Cramwise app icon: an angry "book boss" with horns and an HP bar,
# drawn as 32x32 pixel art, on a purple-to-pink gradient.
from PIL import Image, ImageDraw
import sys

INK = (18, 10, 31)          # outline
LIME = (184, 255, 60)       # book cover (Cramwise's XP colour)
LIME_D = (110, 170, 20)     # spine / shading
LIME_L = (222, 255, 150)    # highlight
PAGE = (255, 244, 214)      # paper edges
HORN = (255, 214, 92)       # gold horns
HORN_D = (196, 140, 30)
WHITE = (255, 255, 255)
RED = (255, 64, 96)
RED_D = (170, 20, 60)
SLOT = (52, 26, 70)

def art():
    a = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    p = a.load()
    def px(x, y, c): p[x, y] = c + (255,)
    def rect(x0, y0, x1, y1, c):
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1): px(x, y, c)
    # chunky horns curving up and out (left one, then mirrored)
    left = {(11,8):HORN_D,(12,8):HORN_D,(10,7):HORN,(11,7):HORN,(12,7):HORN_D,(9,6):HORN,(10,6):HORN,(11,6):HORN_D,
            (8,5):HORN,(9,5):HORN,(10,5):HORN_D,(8,4):HORN,(9,4):(255,240,170),(8,3):(255,240,170)}
    shape = {}
    for (x, y), c in left.items():
        shape[(x, y)] = c
        shape[(31 - x, y)] = c
    for (x, y), c in shape.items(): px(x, y, c)
    for (x, y) in list(shape):
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            q = (x + dx, y + dy)
            if q not in shape and 0 <= q[0] < 32 and 0 <= q[1] < 32 and q[1] < 8 and p[q][3] == 0:
                px(q[0], q[1], INK)
    # book: outline, cover, spine, page edges
    rect(6, 8, 25, 25, INK)
    rect(7, 9, 23, 23, LIME)
    rect(7, 9, 9, 23, LIME_D)          # spine
    rect(10, 9, 10, 23, INK)           # spine crease
    rect(24, 10, 24, 24, PAGE)         # pages on the right
    rect(8, 24, 24, 24, PAGE)          # pages at the bottom
    rect(11, 10, 22, 10, LIME_L)       # top highlight
    # angry eyes
    rect(12, 13, 15, 16, WHITE); rect(17, 13, 20, 16, WHITE)
    rect(12, 13, 15, 13, INK); rect(17, 13, 20, 13, INK)            # lids
    rect(14, 15, 15, 16, INK); rect(17, 15, 18, 16, INK)            # pupils looking in
    for (x, y) in [(11,11),(12,11),(13,12),(14,12),(15,12),(20,11),(19,11),(18,12),(17,12),(16,12)]:
        px(x, y, INK)                                                # brows
    # toothy grin
    rect(12, 18, 20, 21, INK)
    for x in (12, 14, 16, 18, 20): px(x, 18, WHITE)
    for x in (13, 15, 17, 19): px(x, 21, WHITE)
    rect(13, 19, 19, 20, RED_D)
    # HP bar
    rect(5, 27, 26, 30, INK)
    rect(6, 28, 25, 29, SLOT)
    rect(6, 28, 15, 29, RED)
    rect(6, 28, 15, 28, (255, 140, 160))
    return a

def background(size):
    bg = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(bg)
    top, bot = (58, 18, 120), (214, 36, 120)          # deep purple -> hot pink
    for y in range(size):
        for x in range(0, size, 4):
            t = (x * 0.35 + y * 0.65) / size
            c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
            d.rectangle([x, y, x + 3, y], fill=c)
    # a few pixel sparkles
    u = size / 32
    for (sx, sy) in [(3, 4), (28, 7), (27, 22), (2, 19)]:
        for dx, dy in [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]:
            a = 255 if (dx, dy) == (0, 0) else 120
            x0, y0 = (sx + dx) * u, (sy + dy) * u
            d.rectangle([x0, y0, x0 + u - 1, y0 + u - 1], fill=(255, 255, 255) if a == 255 else (255, 190, 230))
    return bg

def icon(size, scale, rounded):
    bg = background(size).convert("RGBA")
    a = art().resize((int(32 * scale * size / 32),) * 2, Image.NEAREST)
    off = (size - a.width) // 2
    bg.alpha_composite(a, (off, off))
    if rounded:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=255)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0)); out.paste(bg, (0, 0), mask)
        return out
    return bg

out = sys.argv[1]
icon(512, 0.94, True).save(f"{out}/icon-512.png")
icon(512, 0.94, True).resize((192, 192), Image.LANCZOS).save(f"{out}/icon-192.png")
icon(512, 0.72, False).save(f"{out}/maskable-512.png")       # art inside the safe circle
icon(512, 0.86, False).convert("RGB").resize((180, 180), Image.LANCZOS).save(f"{out}/apple-touch-icon.png")
icon(256, 1.0, True).resize((64, 64), Image.LANCZOS).save(f"{out}/favicon-64.png")
# preview sheet: big + phone sizes, on dark and light home screens
sheet = Image.new("RGB", (900, 360), (30, 30, 36)); d = ImageDraw.Draw(sheet)
sheet.paste((235, 235, 240), (450, 0, 900, 360))
big = Image.open(f"{out}/icon-512.png").resize((240, 240), Image.LANCZOS)
for ox in (20, 470):
    sheet.paste(big, (ox, 60), big)
    for i, s in enumerate((96, 64, 48, 32)):
        sm = Image.open(f"{out}/icon-512.png").resize((s, s), Image.LANCZOS)
        sheet.paste(sm, (ox + 270 + (0 if i < 2 else 80), 60 + (i % 2) * 120 if i < 2 else 60 + (i - 2) * 80), sm)
sheet.save(f"{out}/preview.png")
