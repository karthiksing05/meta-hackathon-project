#!/usr/bin/env python3
"""Screen audit: opens every published base Curio in the games feed on one simulator, screenshots
the feed page and the playing state, and checks each with scan.py (bands, letterboxing, insets,
a size change between the two states).

Usage:
  DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer \\
  tools/screen-audit/run.py --udid <simulator> --app <DerivedData>/Build/Products/Debug-iphonesimulator/FacebookClone.app \\
      --out <dir> [--ids id1,id2] [--limit n] [--feed-wait 4] [--play-wait 7] [--max-wait 40]

Games come from GET https://api.ol4ol.com/v1/games/stats; Group copies (a groupID) are skipped.
Each game is pinned as the feed's first page with the DEBUG launch variable FB_FEED_GAME, and the
playing state uses FB_FEED_TAKEOVER=1 (the same as a tap). Writes <out>/report.md,
<out>/results.json, <out>/contact-sheet.png and the screenshots in <out>/shots/.
Needs Pillow. Builds nothing and deletes nothing: build the app and create the simulator first.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scan  # noqa: E402

API = "https://api.ol4ol.com"
BUNDLE = "com.karthiksing05.fbclone"


def get_json(path):
    req = urllib.request.Request(API + path, headers={"User-Agent": "screen-audit/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def games(ids=None):
    data = get_json("/v1/games/stats")
    rows = [g for g in data.get("games", []) if not g.get("groupID")]
    if ids:
        rows = [g for g in rows if g.get("id") in ids or g.get("gameID") in ids]
    return rows


def simctl(*args, env=None, check=True):
    return subprocess.run(["xcrun", "simctl", *args], env=env, check=check, capture_output=True, text=True)


def launch(udid, extra):
    env = dict(os.environ)
    base = {"FB_TAB": "bubbles", "FB_SKIP_SPLASH": "1"}
    base.update(extra)
    for k, v in base.items():
        env["SIMCTL_CHILD_" + k] = v
    simctl("launch", "--terminate-running-process", udid, BUNDLE, env=env)


def shoot(udid, path):
    simctl("io", udid, "screenshot", path)


def size_changed(a, b):
    """The game's side edges moved between the feed and playing (a shrunken preview that grows)."""
    la, lb = a["lines"], b["lines"]
    for side in ("left", "right"):
        xa = la.get(side, {}).get("x_pt", 0) if side in la and la[side]["fraction"] >= 0.9 else 0
        xb = lb.get(side, {}).get("x_pt", 0) if side in lb and lb[side]["fraction"] >= 0.9 else 0
        if abs(xa - xb) >= 3:
            return True
    return False


def contact_sheet(results, out, path):
    tw, th = 201, 437  # 1/6 of a 3x iPhone 17 screenshot
    cols = 6  # three games per row, feed + playing
    rows = (len(results) * 2 + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (tw + 8) + 8, rows * (th + 40) + 8), (20, 20, 24))
    d = ImageDraw.Draw(sheet)
    i = 0
    for r in results:
        for state in ("feed", "playing"):
            shot = r.get(state + "_shot")
            x = 8 + (i % cols) * (tw + 8)
            y = 8 + (i // cols) * (th + 40)
            if shot and os.path.exists(shot):
                im = Image.open(shot).convert("RGB").resize((tw, th))
                sheet.paste(im, (x, y))
            ok = r.get(state, {}).get("pass", False) and not (state == "playing" and r.get("size_changed"))
            color = (80, 200, 120) if ok else (240, 90, 90)
            d.rectangle([x - 2, y - 2, x + tw + 1, y + th + 1], outline=color, width=2)
            d.text((x, y + th + 4), (r["title"] or r["id"])[:30], fill=(230, 230, 230))
            d.text((x, y + th + 18), state + (" ok" if ok else " FAIL"), fill=color)
            i += 1
    sheet.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--udid", required=True)
    ap.add_argument("--app", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--ids", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--feed-wait", type=float, default=4)
    ap.add_argument("--max-wait", type=float, default=40)
    ap.add_argument("--play-wait", type=float, default=7)
    ap.add_argument("--no-install", action="store_true")
    a = ap.parse_args()

    shots = os.path.join(a.out, "shots")
    os.makedirs(shots, exist_ok=True)
    ids = set(x for x in a.ids.split(",") if x)
    rows = games(ids)
    if a.limit:
        rows = rows[: a.limit]
    simctl("boot", a.udid, check=False)
    if not a.no_install:
        simctl("install", a.udid, a.app)

    results = []
    for n, g in enumerate(rows, 1):
        gid = g["id"]
        title = ""
        try:
            title = get_json(f"/v1/games/{gid}").get("title") or ""
        except Exception:
            pass
        rec = {"id": gid, "slug": g.get("gameID"), "title": title}
        for state, extra, wait in (
            ("feed", {"FB_FEED_GAME": gid}, a.feed_wait),
            ("playing", {"FB_FEED_GAME": gid, "FB_FEED_TAKEOVER": "1"}, a.play_wait),
        ):
            path = os.path.join(shots, f"{gid}-{state}.png")
            try:
                launch(a.udid, extra)
                # Wait for the page to draw (the feed can take a while), then let it settle.
                start = time.time()
                time.sleep(4)
                while time.time() - start < a.max_wait:
                    shoot(a.udid, path)
                    if "blank page" not in scan.scan(path)["issues"]:
                        break
                    time.sleep(2)
                time.sleep(wait)
                shoot(a.udid, path)
                rec[state + "_shot"] = path
                rec[state] = scan.scan(path)
            except subprocess.CalledProcessError as e:
                rec[state] = {"pass": False, "issues": ["launch failed: " + (e.stderr or "")[:120]], "lines": {}}
        rec["size_changed"] = bool(rec.get("feed") and rec.get("playing") and size_changed(rec["feed"], rec["playing"]))
        rec["pass"] = rec.get("feed", {}).get("pass") and rec.get("playing", {}).get("pass") and not rec["size_changed"]
        results.append(rec)
        print(f"[{n}/{len(rows)}] {'PASS' if rec['pass'] else 'FAIL'} {gid} {title} "
              f"{rec.get('feed', {}).get('issues')} {rec.get('playing', {}).get('issues')}", flush=True)
        with open(os.path.join(a.out, "results.json"), "w") as f:
            json.dump(results, f, indent=1)

    simctl("terminate", a.udid, BUNDLE, check=False)
    contact_sheet(results, a.out, os.path.join(a.out, "contact-sheet.png"))
    passed = sum(1 for r in results if r["pass"])
    lines = [
        "# Screen audit",
        "",
        f"{passed} of {len(results)} base Curios pass (feed page and playing state, edge to edge, same size).",
        "",
        "| Curio | id | Feed | Playing | Size change |",
        "|---|---|---|---|---|",
    ]
    for r in results:
        f = r.get("feed", {})
        p = r.get("playing", {})
        lines.append(f"| {r['title']} | `{r['id']}` | {'ok' if f.get('pass') else ', '.join(f.get('issues', []))} | "
                     f"{'ok' if p.get('pass') else ', '.join(p.get('issues', []))} | {'yes' if r['size_changed'] else 'no'} |")
    lines += ["", "Contact sheet: contact-sheet.png (green = pass, red = fail). Raw numbers: results.json."]
    with open(os.path.join(a.out, "report.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{passed}/{len(results)} pass")


if __name__ == "__main__":
    main()
