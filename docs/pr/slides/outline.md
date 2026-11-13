# Slide outline (draft 8: Karthik's story arc)

*Three acts, one main graphic per slide with one plain caption; the rest is in [notes.md](notes.md). Rubric labels stay small. 11 slides, 170 s of talk + 95 s of demo = 4:25, 35 s of slack. Blue = competing, violet = collaborating.*

| # | Act | Graphic | Caption on screen | Demo |
|---|---|---|---|---|
| 1 | Why | Dictionary entry + wordmark ("a new feature in Facebook") | cu·rio; Merriam-Webster's sense; "a tiny game anyone makes with Muse, played with your people" | **Demo 1 starts** |
| 2 | Why | Two arrows, "against" (blue) and "together" (violet), into "closer" | "We grow close by playing with each other, and against each other." + three evidence lines [72][127][66] | |
| 3 | Why | Bars: 98% play games vs teens on Facebook 71% → 32% | "Facebook has the people, but not the reason to open it." + loneliest 27% [60] | |
| 4 | Why | The mock "guess what they say" clip (mock/guess-clip.mp4), a LinkedIn-style daily grid, an NYT-style word grid | one line per picture + stat; Wordle 5.3B → 4.2B in the footer [83] | |
| 5 | How · Originality | Sentence bubble → a real Curio screenshot | "One sentence → a playable Curio, about a minute after you agree the plan." | (building) |
| 6 | How · AI | Pipeline: Spark → 1,280 types (0.94) → Ember → Wonder → compose + up to 3 repairs → 5-bot gate + score check | "Any idea, made reliable." | |
| 7 | How · AI | JSON → Rust/WASM (~1 MB) → the phone (dark) | "Same seed for everyone, and the server replays every score. Competition only brings people together if it's fair." | **Demo 1 pays off** |
| 8 | What it does · Originality | Vertical flow, blue → violet: weekly board → "How did you get 44?" → Add friend → best of 5 → make together or remix; live-phone frame | in the app / on the server tags | **Demo 3** |
| 9 | What it does · AI | Two simulated bar charts (70.3% vs a tie; Group Blend 8.7% → 32%) | "Play becomes a signal." | **Demo 2** |
| 10 | Execution | Statement | "We built a collaborative product collaboratively." 489 commits | |
| 11 | Close | Small ritual chart (3% vs 8–11%) + the tagline, its only appearance | "When the world is your muse, how will you create the content of tomorrow?" | |

**Mock clip:** `mock/guess-clip.html` (a fictional cartoon mayor; no real person, footage or audio), rendered by `mock/render-clip.sh` to `guess-clip.mp4` (720x1280, 6.5 s loop, for Keynote) and `guess-clip.gif`.
**Screenshots:** the app still says "Whims" and the live DB is nearly empty, so slides 5 and 7 use a crop of a real Curio (no app chrome) and slide 8 is a live-phone frame.
**Karthik's calls:** (a) Keynote + Live Video or (b) HTML/PDF + QuickTime, viewer donations, WeChat (out for now), whose Mac presents.
