"""Generates AppIcon.icns. Run by build_app.sh; needs nothing but Pillow.

A sharp sign on the app's own dark plate. Chosen because it is unmistakably
musical at 32 px in a Cmd-Tab strip, which is the size that actually decides
whether an icon works -- a waveform or a mule at that size is a smudge.

Drawn as polygons rather than set as a glyph so the strokes stay crisp at
every rung of the iconset and do not depend on a font being present.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).parent

PLATE = (21, 24, 27)        # --panel from the app's stylesheet
PLATE_EDGE = (43, 49, 55)   # --line
AMBER = (255, 182, 39)      # --amber


def draw(size: int) -> Image.Image:
    """One square icon at `size`. Everything scales off it, so every rung of
    the iconset is drawn rather than resampled from a single bitmap."""
    # Supersample, then reduce: the sharp's slanted bars alias badly otherwise.
    ss = 4
    s = size * ss
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = s * 0.22
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=PLATE)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius,
                        outline=PLATE_EDGE, width=max(1, int(s * 0.012)))

    cx, cy = s / 2, s / 2

    # What separates a sharp from a hash: the verticals are THIN and straight,
    # the horizontals are THICK and clearly slanted. Drawn at equal weight with
    # both sets slanted, it reads as a hashtag -- which the first attempt did.
    v_h = s * 0.60          # vertical bar height
    v_w = s * 0.052         # vertical bar width, deliberately thin
    v_dx = s * 0.118        # half the gap between the verticals

    for sign in (-1, 1):
        x = cx + sign * v_dx
        d.rectangle([x - v_w / 2, cy - v_h / 2, x + v_w / 2, cy + v_h / 2], fill=AMBER)

    h_w = s * 0.44          # horizontal bar length
    h_h = s * 0.115         # thickness, roughly twice the verticals
    rise = s * 0.085        # the right end sits this far above the left
    for sign in (-1, 1):
        y = cy + sign * s * 0.145
        d.polygon(
            [
                (cx - h_w / 2, y + rise - h_h / 2),
                (cx + h_w / 2, y - rise - h_h / 2),
                (cx + h_w / 2, y - rise + h_h / 2),
                (cx - h_w / 2, y + rise + h_h / 2),
            ],
            fill=AMBER,
        )

    return img.resize((size, size), Image.LANCZOS)


def main() -> int:
    iconset = OUT / "AppIcon.iconset"
    iconset.mkdir(exist_ok=True)

    # The rungs macOS actually asks for. Both scales of each size, because a
    # missing @2x shows up as a blurry icon on exactly the displays in use.
    for base in (16, 32, 128, 256, 512):
        draw(base).save(iconset / f"icon_{base}x{base}.png")
        draw(base * 2).save(iconset / f"icon_{base}x{base}@2x.png")

    result = subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "AppIcon.icns")],
        capture_output=True,
    )
    if result.returncode != 0:
        print(result.stderr.decode(), file=sys.stderr)
        return 1

    for png in iconset.glob("*.png"):
        png.unlink()
    iconset.rmdir()
    print(f"wrote {OUT / 'AppIcon.icns'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
