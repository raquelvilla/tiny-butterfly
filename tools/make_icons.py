#!/usr/bin/env python3
"""Draws the Tiny Butterfly app icons as PNGs. No dependencies; run once: python3 tools/make_icons.py"""
import math
import pathlib
import struct
import zlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "icons"

TOP = (0xF6, 0xC9, 0xB8)     # peach
BOTTOM = (0xC9, 0xB6, 0xF2)  # lilac
WING_A = (0xE4, 0x57, 0x2E)  # flame
WING_B = (0x3D, 0x2C, 0x8D)  # deep violet
BODY = (0x1E, 0x1A, 0x1D)


def in_ellipse(x, y, cx, cy, rx, ry, ang):
    c, s = math.cos(ang), math.sin(ang)
    dx, dy = x - cx, y - cy
    u, v = dx * c + dy * s, -dx * s + dy * c
    return (u / rx) ** 2 + (v / ry) ** 2 <= 1


def butterfly(x, y, k):
    """x, y in [-1, 1] (y down). Returns a colour, or None for background."""
    bx, by = abs(x / k), y / k
    if in_ellipse(bx, by, 0.0, 0.02, 0.05, 0.40, 0):
        return BODY
    if in_ellipse(bx, by, 0.10, -0.50, 0.014, 0.16, 0.45):
        return BODY  # antennae
    if in_ellipse(bx, by, 0.38, -0.20, 0.36, 0.27, -0.5):
        return WING_B if in_ellipse(bx, by, 0.44, -0.25, 0.15, 0.10, -0.5) else WING_A
    if in_ellipse(bx, by, 0.27, 0.25, 0.22, 0.18, 0.6):
        return WING_B
    return None


def render(size, k, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size * 2 - 1
                    y = (py + (sy + 0.5) / ss) / size * 2 - 1
                    c = butterfly(x, y, k)
                    if c is None:
                        t = (y + 1) / 2
                        c = [TOP[i] * (1 - t) + BOTTOM[i] * t for i in range(3)]
                    for i in range(3):
                        acc[i] += c[i]
            row.extend(int(a / (ss * ss) + 0.5) for a in acc)
        rows.append(bytes(row))
    return png(size, size, b"".join(rows))


def png(w, h, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for name, size, k in [("icon-180.png", 180, 0.85), ("icon-192.png", 192, 0.85),
                          ("icon-512.png", 512, 0.85), ("icon-maskable-512.png", 512, 0.62)]:
        (OUT / name).write_bytes(render(size, k))
        print("wrote", name)
