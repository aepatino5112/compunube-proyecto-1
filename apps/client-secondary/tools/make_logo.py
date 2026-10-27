"""Render the Surf Club decal used by the Tk window header.

Tk cannot load a font file at run time, so the wordmark is drawn once with the
web's bundled Lilita One (apps/web/dist/assets/fonts, OFL) and committed as a
PNG. Pillow is only needed to regenerate it:

    python tools/make_logo.py
"""

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONT = HERE.parents[1] / "web" / "dist" / "assets" / "fonts" / "LilitaOne-Regular.ttf"
OUT = HERE.parent / "compunube_client" / "assets" / "surf-club-logo.png"

INK, CORAL, SUN = (18, 57, 59, 255), (255, 116, 82, 255), (255, 209, 102, 255)
SCALE = 4  # supersampled, then reduced for smooth edges
W, H = 360, 76


def s(value: float) -> int:
    return round(value * SCALE)


def sun(image: Image.Image):
    """Striped sunset sun cut by two waves, like the web wordmark."""
    cx, cy, r = 34, 31, 24
    layer = Image.new("RGBA", image.size, SUN)
    draw = ImageDraw.Draw(layer)
    draw.rectangle((0, s(cy), image.width, image.height), fill=CORAL)
    for top, height in ((cy + 3.5, 2.4), (cy + 9.5, 3.2), (cy + 16, 4)):
        draw.rectangle((0, s(top), image.width, s(top + height)), fill=(0, 0, 0, 0))
    disc = Image.new("L", image.size, 0)
    ImageDraw.Draw(disc).ellipse((s(cx - r), s(cy - r), s(cx + r), s(cy + r)), fill=255)
    layer.putalpha(ImageChops.multiply(layer.getchannel("A"), disc))
    image.alpha_composite(layer)
    draw = ImageDraw.Draw(image)
    draw.ellipse((s(cx - r), s(cy - r), s(cx + r), s(cy + r)), outline=INK, width=s(3))
    for y, amp in ((cy + 21, 3.5), (cy + 29, 3)):
        draw.line(wave(4, 64, y, amp), fill=INK, width=s(3.4), joint="curve")


def wave(x0: float, x1: float, y: float, amp: float):
    steps = int((x1 - x0) * 2)
    return [(s(x0 + i / 2), s(y + amp * math.sin(i / 2 / 15 * math.pi * 2))) for i in range(steps + 1)]


def wordmark(image: Image.Image):
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT), s(40))
    x, y = 74, 4
    draw.text((s(x + 3), s(y + 3)), "Surf Club", font=font, fill=CORAL)
    draw.text((s(x), s(y)), "Surf Club", font=font, fill=INK)

    small = ImageFont.truetype(str(FONT), s(13))
    text = "ACCIÓN POR LAS AGUAS"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=small)
    pad_x, pad_y = s(9), s(5)
    ribbon = Image.new("RGBA", (right - left + 2 * pad_x + s(3), bottom - top + 2 * pad_y + s(3)), (0, 0, 0, 0))
    ribbon_draw = ImageDraw.Draw(ribbon)
    box = (0, 0, right - left + 2 * pad_x, bottom - top + 2 * pad_y)
    ribbon_draw.rounded_rectangle((box[0] + s(3), box[1] + s(3), box[2] + s(3), box[3] + s(3)), s(6), fill=CORAL)
    ribbon_draw.rounded_rectangle(box, s(6), fill=INK)
    ribbon_draw.text((pad_x - left, pad_y - top), text, font=small, fill=SUN)
    ribbon = ribbon.rotate(3, resample=Image.BICUBIC, expand=True)
    image.alpha_composite(ribbon, (s(x + 4), s(48)))


def main():
    image = Image.new("RGBA", (s(W), s(H)), (0, 0, 0, 0))
    sun(image)
    wordmark(image)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.resize((W, H), Image.LANCZOS).save(OUT, optimize=True)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
