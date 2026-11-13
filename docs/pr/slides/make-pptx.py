#!/usr/bin/env python3
"""Builds deck.pptx from png/slide-N.png (run render.sh first) with the speaker notes from notes.md.
Each slide is one full-bleed picture, so it looks exactly like the HTML deck in Keynote or PowerPoint.
Edit text in deck.html, re-render, re-run this. Needs: pip install python-pptx."""
import os, re, glob
from pptx import Presentation
from pptx.util import Emu
here = os.path.dirname(os.path.abspath(__file__))
notes = {}
for m in re.finditer(r'^## (\d+)\n(.*?)(?=^## |\Z)', open(os.path.join(here, 'notes.md')).read(), re.S | re.M):
    notes[int(m.group(1))] = m.group(2).strip()
prs = Presentation()
prs.slide_width, prs.slide_height = Emu(12192000), Emu(6858000)  # 16:9
pngs = sorted(glob.glob(os.path.join(here, 'png', 'slide-*.png')), key=lambda p: int(re.findall(r'(\d+)', os.path.basename(p))[0]))
for i, p in enumerate(pngs, 1):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.shapes.add_picture(p, 0, 0, prs.slide_width, prs.slide_height)
    if i in notes:
        s.notes_slide.notes_text_frame.text = notes[i]
prs.save(os.path.join(here, 'deck.pptx'))
print(f'deck.pptx: {len(pngs)} slides, {len(notes)} with notes')
