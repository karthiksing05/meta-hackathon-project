# Pitch slides

- `deck.html`: the deck (1920x1080 slides). Open it in Chrome to present (arrow keys; `deck.html#3` opens slide 3).
- `render.sh`: exports `png/slide-N.png` and `deck.pdf` with headless Chrome.
- `outline.md`: every slide, its narrative point and its demo beat.
- `notes.md`: speaker notes, one block per slide (also the video voice-over).
- `deck.pptx`: for Keynote (File → Open) or PowerPoint. Each slide is the rendered PNG, with its speaker notes. Rebuild with `./render.sh && python3 make-pptx.py` (needs `pip install python-pptx`). In Keynote, add the live phone at the demo beats (slides 4, 8, 9) with Insert → Live Video.
- `fonts/Figtree.ttf`: the font (SIL Open Font License, `fonts/OFL.txt`). Install it on the presenting Mac (double-click it) if you import the deck into Keynote.

Claims come from [../narrative.md](../narrative.md). Change a claim there first, then here, in `../devpost.md` and in the video script.
