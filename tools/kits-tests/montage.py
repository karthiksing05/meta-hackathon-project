#!/usr/bin/env python3
"""Side-by-side contact sheet of screenshots: montage.py out.png a.png b.png ... [--w 300]"""
import sys
from PIL import Image
args = sys.argv[1:]
w = 300
if "--w" in args:
    i = args.index("--w"); w = int(args[i + 1]); del args[i:i + 2]
out, files = args[0], args[1:]
ims = []
for f in files:
    im = Image.open(f).convert("RGB")
    h = round(im.height * w / im.width)
    ims.append(im.resize((w, h), Image.LANCZOS))
H = max(im.height for im in ims)
sheet = Image.new("RGB", (w * len(ims) + 8 * (len(ims) - 1), H), (255, 255, 255))
for i, im in enumerate(ims):
    sheet.paste(im, (i * (w + 8), 0))
sheet.save(out)
print(out)
