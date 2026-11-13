# Pitch slides

**Current state:** draft 12, 26 slides, on branch `pitch`. The talk runs about 6:25 untrimmed (timing table at the top of `notes.md`); Karthik asked not to trim until he says so.

## Files

- `deck.html`: the deck (1920x1080 slides). Open it in Chrome to present (arrow keys; `deck.html#3` opens slide 3). All styling is inline; later `/* draft 12 */` blocks at the end of `<style>` override earlier rules.
- `notes.md`: speaker notes, one `## N` block per slide, plus the timing table and the demo checklist.
- `outline.md`: one line per slide (section, title, start of the notes). Regenerate it when slides move.
- `sources-by-slide.md`: where every number on every slide comes from. Add a line here whenever you add a number.
- `render.sh`: exports `png/slide-N.png` and `deck.pdf` (gitignored) with headless Chrome.
- `make-pptx.py`: builds `deck.pptx` (pictures plus notes) for PowerPoint. Needs `pip install python-pptx`.
- `keynote/build.sh`: builds the Keynote deck Karthik presents from (see below).
- `keynote/snap-phones.applescript`: moves Live Video boxes onto the phone frames on slides 10 and 11.
- `img/`: pictures used by the deck (our own app screens and Muse-made games only).
- `fonts/Figtree.ttf`: the font (SIL Open Font License). Install it on the presenting Mac.

## Making a change

1. Edit `deck.html` (and `notes.md`, `sources-by-slide.md` if the words or numbers change).
2. `./render.sh` to re-render the PNGs.
3. Look at every PNG you touched. Check that no text spills out of its box or off the slide, and that nothing is clipped.
4. Rebuild Keynote: `keynote/build.sh` (writes `~/Desktop/Muse Curios pitch.key` by default; pass a path to change it).
5. Commit on `pitch`: run `scripts/check-secrets.sh`, fetch and rebase, then push. Never force-push.

## Keynote and the live phones

- The Keynote deck is one full-bleed picture per slide with speaker notes. Edit in `deck.html`, not in Keynote.
- Slides 5 and 6 get the real NYT, Krillion and Reels screenshots as overlays. They're copyrighted, so they stay outside the repo in `game-backups/reference/`, next to the main checkout. `build.sh` finds them there (or set `REF=`).
- A full rebuild drops Live Video. After rebuilding, insert Live Video on slide 10 (Karthik's iPhone) and twice on slide 11 (Karthik's, then Bayan's). Then run `osascript keynote/snap-phones.applescript` to snap them into the phone frames.
- Keep only one Keynote document open at a time.

## Rules that hold for every slide

- No footers: sources go in `sources-by-slide.md`.
- Tagline only on the last slide: "When the world is your muse, how will you create the content of tomorrow?"
- "Made by Muse" only for games Muse actually built: Golden S'more, Biscuit's First Day, Root Words, and the harness-v2 build of Mr. Beast Brainrot Trivia (slide 15). The Podium, Purr Earth, First Things First and One Move are hand-made.
- Ranker and Group Blend numbers are labelled "simulated". Group play is async on the same seed, not live.
- Real brand, creator and franchise names are fine. No photoreal real people, and no copied audio.

Claims come from [../narrative.md](../narrative.md). Change a claim there first, then here, in `../devpost.md` and in the video script.
