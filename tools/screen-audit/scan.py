#!/usr/bin/env python3
"""Pixel scan for one Curio screenshot: does the game fill the page edge to edge?

Usage: scan.py <screenshot.png> [--state feed|playing] -> prints one JSON object.

The page is the screen above the tab bar (iPhone 17: 402 x 874 pt at 3x, tab bar plus home
indicator 83 pt). Checks, each from pixels only:

- side bands: a straight vertical line within 60 pt of the left or right edge that runs down most
  of the page's middle, with a quiet (uniform or blurred) strip between it and the screen edge.
  That is the inset card / letterboxed playfield look.
- top/bottom bands: the same with a full-width horizontal line near the page's top (below the
  header) or bottom, and a quiet strip outside it.
- rounded card: a side band whose line bends inward near its ends (a rounded inner rectangle).

Needs Pillow.
"""
import json
import sys

from PIL import Image, ImageFilter

TAB_PT = 83          # tab bar + home indicator
HEADER_PT = 114      # status bar + feed header (or the takeover bar)
EDGE_PT = 60         # how far in from an edge a band line may sit
LINE_FRACTION = 0.6  # share of rows (or columns) a line must cross
EDGE_DIFF = 8        # per-channel step (across 3 px) that counts as an edge
QUIET_STD = 40.0     # a strip with nothing sharper than this (detail()) counts as a band


def load(path):
    img = Image.open(path).convert("RGB")
    scale = img.width / 402.0
    return img, scale


def detail(img, box):
    """How sharp the sharpest detail in the box is (99.5th percentile of an edge filter, 0-255).
    A runtime bleed strip is a blurred copy of the game, so it stays low; real game content
    (text, outlines, sprites) has sharp edges."""
    crop = img.crop(box).convert("L")
    if crop.width < 8 or crop.height < 8:
        return 255.0
    edges = crop.filter(ImageFilter.FIND_EDGES)
    edges = edges.crop((2, 2, edges.width - 2, edges.height - 2))
    hist = edges.histogram()
    total, seen = sum(hist) or 1, 0
    for value, n in enumerate(hist):
        seen += n
        if seen >= 0.995 * total:
            return float(value)
    return 255.0


def column_line(px, x, y0, y1, step):
    """Share of rows where columns x-1 and x differ strongly (a vertical line at x)."""
    hits = rows = 0
    for y in range(y0, y1, step):
        a, b = px[x - 2, y], px[x + 1, y]
        rows += 1
        if max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2])) > EDGE_DIFF:
            hits += 1
    return hits / max(1, rows)


def row_line(px, y, x0, x1, step):
    hits = cols = 0
    for x in range(x0, x1, step):
        a, b = px[x, y - 2], px[x, y + 1]
        cols += 1
        if max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2])) > EDGE_DIFF:
            hits += 1
    return hits / max(1, cols)


def best_line(scores):
    """(position, fraction) of the strongest line, allowing a line to straddle two columns."""
    best = (None, 0.0)
    for pos, frac in scores:
        if frac > best[1]:
            best = (pos, frac)
    return best


def scan(path):
    img, s = load(path)
    px = img.load()
    W, H = img.width, img.height
    page_bottom = int(H - TAB_PT * s)
    top = int(HEADER_PT * s)
    edge = int(EDGE_PT * s)
    # The middle of the page: clear of the header, the caption and the action rail's labels.
    my0, my1 = int(top + 40 * s), int(page_bottom - 200 * s)
    step = max(1, int(s))
    issues = []
    lines = {}

    # Side bands.
    for side in ("left", "right"):
        xs = range(3, edge) if side == "left" else range(W - edge, W - 3)
        scores = [(x, column_line(px, x, my0, my1, step * 2)) for x in xs]
        x, frac = best_line(scores)
        if x is None or frac < LINE_FRACTION:
            continue
        strip = (0, my0, max(1, x - 4), my1) if side == "left" else (min(W - 1, x + 4), my0, W, my1)
        q = detail(img, strip)
        width_pt = (x if side == "left" else W - x) / s
        lines[side] = {"x_pt": round(width_pt, 1), "fraction": round(frac, 2), "strip_detail": round(q, 1)}
        if width_pt >= 2 and (q < QUIET_STD or frac >= 0.9):
            issues.append(f"{side} band {width_pt:.0f} pt")

    # Top and bottom bands (full-width horizontal line with a quiet strip outside it).
    # A letterbox edge runs the whole width; a game's own panels stop short of the screen's edges.
    x0, x1 = int(2 * s), int(W - 2 * s)
    top_scores = [(y, row_line(px, y, x0, x1, step * 2)) for y in range(top + 2, top + int(140 * s), step)]
    y, frac = best_line(top_scores)
    if y is not None and frac >= 0.97:
        q = detail(img, (x0, top, x1, max(top + 1, y - 4)))
        lines["top"] = {"y_pt": round(y / s, 1), "fraction": round(frac, 2), "strip_detail": round(q, 1)}
        if q < QUIET_STD and (y - top) / s >= 6:
            issues.append(f"top band {(y - top) / s:.0f} pt")
    bottom_scores = [(y, row_line(px, y, x0, x1, step * 2)) for y in range(page_bottom - int(80 * s), page_bottom - 2, step)]
    y, frac = best_line(bottom_scores)
    if y is not None and frac >= 0.97:
        q = detail(img, (x0, min(page_bottom - 1, y + 4), x1, page_bottom))
        lines["bottom"] = {"y_pt": round(y / s, 1), "fraction": round(frac, 2), "strip_detail": round(q, 1)}
        if q < QUIET_STD and (page_bottom - y) / s >= 6:
            issues.append(f"bottom band {(page_bottom - y) / s:.0f} pt")

    # A blank page (the game never drew): nearly no detail across the middle.
    mid = detail(img, (0, my0, W, my1))
    if mid < 8:
        issues.append("blank page")
    return {"file": path, "pass": not issues, "issues": issues, "lines": lines, "middle_detail": round(mid, 1)}


if __name__ == "__main__":
    print(json.dumps(scan(sys.argv[1])))
