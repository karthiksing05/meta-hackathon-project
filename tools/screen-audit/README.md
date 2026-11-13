# Screen audit

Opens every published base Curio (Prod `GET /v1/games/stats`, Group copies skipped) as the first
page of the games feed on one simulator, screenshots the feed page and the playing state (the same
as a tap, `FB_FEED_TAKEOVER=1`), and checks each screenshot with a pixel scan:

- **Side bands**: a straight vertical line within 60 pt of an edge down most of the page, with a
  blurred or flat strip outside it (an inset card, a letterboxed or shrunken playfield).
- **Top and bottom bands**: a line across the whole width near the page's top (under the header)
  or bottom, with a blurred or flat strip outside it.
- **Size change**: the game's side edges move between the feed page and the playing state (a
  minimized preview that expands on tap).
- **Blank page**: nothing sharp in the middle of the page (the game never drew).

```sh
export DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer
xcodebuild -project FacebookClone.xcodeproj -scheme FacebookClone \
  -destination 'id=<udid>' -derivedDataPath <your-dir> build
tools/screen-audit/run.py --udid <udid> \
  --app <your-dir>/Build/Products/Debug-iphonesimulator/FacebookClone.app --out <out-dir>
# one screenshot: tools/screen-audit/scan.py shot.png
```

Writes `report.md`, `results.json`, `contact-sheet.png` (green pass, red fail) and `shots/`.
Calibrated for an iPhone 17 simulator (402 × 874 pt). Needs Python 3 with Pillow. The pinned first
page uses the DEBUG launch variable `FB_FEED_GAME=<id>`.
