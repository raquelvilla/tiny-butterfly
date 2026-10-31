#!/usr/bin/env python3
"""Draws the Tiny Butterfly icons from the dotted mark in index.html's header. Needs Pillow.

    python3 tools/make_icons.py

Writes the app's own icons (icons/*.png, icons/favicon.svg, white) and a full set in two looks:
icons/set/white (black dots on white) and icons/set/black (lilac dots on black), each with favicons,
home-screen sizes, a maskable icon and a macOS .icns for the Desktop app.
"""
import pathlib
import re
import shutil
import subprocess

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
LOOKS = {  # name: (background, dots)
    "white": ("#FFFFFF", "#111111"),
    "black": ("#111111", "#C9B6F2"),
}


def mark():
    """The header's dots (viewBox 40 x 31): their <circle> tags and (cx, cy, r)."""
    html = (ROOT / "index.html").read_text()
    svg = html[html.index('<svg viewBox="0 0 40 31"'):]
    svg = svg[:svg.index("</svg>")]
    tags = re.findall(r"<circle[^>]*/>", svg)
    dots = [tuple(map(float, m)) for m in re.findall(r'cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"', svg)]
    return tags, dots


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def draw(dots, size, bg, ink, mark_w, tile=None, radius=0):
    """Mark centred, mark_w wide (fraction of the canvas). tile: macOS rounded tile (fraction), else full bleed."""
    S = 4
    W = size * S
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0) if tile else rgb(bg) + (255,))
    d = ImageDraw.Draw(img)
    if tile:
        m = W * (1 - tile) / 2
        d.rounded_rectangle([m, m, W - m, W - m], radius=radius * W, fill=rgb(bg) + (255,))
    sc = mark_w * W / 40
    ox, oy = W / 2 - 20 * sc, W / 2 - 15.5 * sc
    for x, y, r in dots:
        cx, cy, rr = ox + x * sc, oy + y * sc, r * sc
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=rgb(ink) + (255,))
    return img.resize((size, size), Image.LANCZOS)


def favicon_svg(tags, bg, ink):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="{bg}"/>'
            f'<g fill="{ink}" transform="translate(12 16.5)">{"".join(tags)}</g></svg>\n')


def write_set(tags, dots, out, bg, ink):
    out.mkdir(parents=True, exist_ok=True)
    (out / "logo.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 31" fill="{ink}">{"".join(tags)}</svg>\n')
    (out / "favicon.svg").write_text(favicon_svg(tags, bg, ink))
    for s in (16, 32, 48):
        draw(dots, s, bg, ink, .78).save(out / f"favicon-{s}.png")
    for s in (180, 192, 512, 1024):
        draw(dots, s, bg, ink, .5).save(out / f"icon-{s}.png")
    draw(dots, 512, bg, ink, .4).save(out / "icon-maskable-512.png")  # stays inside Android's safe circle
    big = draw(dots, 1024, bg, ink, .43, tile=824 / 1024, radius=185 / 1024)  # Apple's icon grid
    big.save(out / "mac-1024.png")
    iconset = out / "mac.iconset"
    iconset.mkdir(exist_ok=True)
    for s in (16, 32, 128, 256, 512):
        big.resize((s, s), Image.LANCZOS).save(iconset / f"icon_{s}x{s}.png")
        big.resize((s * 2, s * 2), Image.LANCZOS).save(iconset / f"icon_{s}x{s}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(out / "mac.icns")], check=True)
    shutil.rmtree(iconset)


if __name__ == "__main__":
    tags, dots = mark()
    for name, (bg, ink) in LOOKS.items():
        write_set(tags, dots, ICONS / "set" / name, bg, ink)
        print("wrote icons/set/" + name)
    # The app itself uses the white look
    white = ICONS / "set" / "white"
    for n in ("icon-180.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "favicon.svg", "favicon-32.png", "favicon-48.png"):
        shutil.copy(white / n, ICONS / n)
    print("app icons: white")
