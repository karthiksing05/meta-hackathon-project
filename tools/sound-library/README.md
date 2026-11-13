# Sound library: curation and import

The sounds people pick to play behind games (`/v1/sounds`, backend/README.md "Sounds"). Kevin's request:
100–200 recognizable songs and trending audios.

## The rule we follow

Trending TikTok / Reels audio is almost all commercial recordings. Being popular on those platforms doesn't
license copying the file into our app, and the team's standing rule (Karthik) is *no copied recorded songs*.
So:

- **`trends.json`**: what's actually trending (178 entries, researched 2026-11-13 from third-party chart
  trackers and trend reports; every entry has the source URLs and the date it reports). Kept as data.
- **`trend-map.json`**: each trend, marked `reusable: false` with the reason, and the closest track in our
  library by mood, energy and BPM, as its stand-in.
- **`catalog.json`**: the tracks we actually re-host. All are licensed for redistribution in an app:
  currently Kevin MacLeod's library (incompetech.com, CC BY 4.0), led by tracks that are themselves well known
  meme and video audio ("Monkeys Spinning Monkeys", "Fluffing a Duck", "Sneaky Snitch", "Investigations",
  "Local Forecast"), then filled per mood (hype, funny, cute, chill, epic, suspense, sad, victory, retro).
  Each entry keeps the licence, the full attribution line, the source page and the ISRC.

Sources checked and ruled out (licence text, 2026-11-13): Pixabay Music (no standalone redistribution, no
building a competing library), YouTube Audio Library (YouTube only), Mixkit and Uppbeat (no standalone
redistribution / games), most of ccMixter and FMA (non-commercial). OpenGameArt (CC0 / CC BY only, never
CC BY-SA) and Freesound (CC0 loops) are fine for later additions.

## Credit

CC BY needs the credit wherever the track is used. A sound package's manifest carries it
(`artist`, `license`, `attribution`, `source_url`, `tags`); the API shows the artist as the sound's creator
and returns the credit, and the app's sound page shows the attribution line and a Source link.

## Running it

```sh
python3 tools/sound-library/build.py            # download (start of each file only), cut 45 s, level, encode m4a, dedupe, zip
API=https://api.ol4ol.com SOUNDS_EMAIL=... SOUNDS_PASSWORD=... node tools/sound-library/upload.mjs
```

`build.py` writes `out/<key>.zip` and `out/report.json` (built / duplicate / skipped / failed); it needs macOS
`afconvert`. `upload.mjs` signs in as the studio account (credentials from the environment, never printed),
skips titles already in the library, uploads with `POST /v1/sounds`, checks each `audioUrl` serves audio, and
writes `out/uploaded.json`. Downloads and outputs (`cache/`, `out/`) are not committed.
