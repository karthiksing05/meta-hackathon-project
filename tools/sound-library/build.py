#!/usr/bin/env python3
"""Builds the sound library's upload packages from a curated catalog (tools/sound-library/catalog.json).

Each catalog entry is a track we're allowed to re-host (CC0, CC-BY with attribution, or a licence that
allows redistribution in an app; see README.md). For each one this:
  1. downloads the file once into the cache (skipped if already there),
  2. decodes it to PCM with macOS afconvert, cuts a clip (start_s, up to max 45 s), fades the ends and
     levels the loudness (peak and RMS), then encodes AAC .m4a at 128 kb/s,
  3. dedupes by the decoded audio's hash and by normalized title + creator,
  4. writes a sound package zip (manifest.json + loop.m4a) in the shape POST /v1/sounds takes:
     {"title", "audio", "duration_ms", "bpm"?, "kind": "library"}.

Usage:  python3 tools/sound-library/build.py [--only KEY ...]
Output: tools/sound-library/out/<key>.zip and out/report.json. Nothing is uploaded here (upload.mjs does).
"""
import argparse, array, audioop, hashlib, time, json, math, os, re, struct, subprocess, sys, tempfile, urllib.request, wave, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
OUT = os.path.join(HERE, "out")
MAX_S = 45.0
FADE_S = 0.6
TARGET_RMS_DB = -18.0
PEAK = 0.89  # about -1 dBFS
UA = "sound-library-builder/1.0 (hackathon project; re-hosting only CC0/CC-BY/redistributable tracks)"


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def fetch(url, dest, max_bytes=None):
    """Downloads url to dest once. max_bytes asks for just the start of the file (an HTTP Range): a 45 s clip
    of a 320 kb/s MP3 needs about 2 MB, and a cut-off MP3 still decodes."""
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    headers = {"User-Agent": UA}
    if max_bytes:
        headers["Range"] = f"bytes=0-{max_bytes - 1}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r, open(dest + ".part", "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    os.replace(dest + ".part", dest)
    return dest


def decode(src, wav):
    subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@44100", "-c", "2", src, wav],
                   check=True, capture_output=True)


def clip(wav_in, wav_out, start_s, max_s):
    with wave.open(wav_in, "rb") as w:
        ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        assert sw == 2
        start = max(0, min(int(start_s * rate), max(0, n - rate)))
        w.setpos(start)
        frames = w.readframes(min(n - start, int(max_s * rate)))
    samples = array.array("h"); samples.frombytes(frames)
    if sys.byteorder != "little":
        samples.byteswap()
    total = len(samples) // ch
    if total < rate * 3:
        raise ValueError("clip shorter than 3 s")
    # level: RMS to the target, then limit the peak
    step = max(1, len(samples) // 200000)  # sample the RMS, it's only for gain
    sub = samples[::step]
    rms = math.sqrt(sum(v * v for v in sub) / len(sub)) / 32768 or 1e-9
    peak = max(max(samples), -min(samples)) / 32768 or 1e-9
    gain = min(10 ** (TARGET_RMS_DB / 20) / rms, PEAK / peak)
    fade = int(FADE_S * rate)
    # gain in C (audioop), then fade only the first and last FADE_S
    out = array.array("h"); out.frombytes(audioop.mul(samples.tobytes(), 2, gain))
    for i in list(range(fade)) + list(range(total - fade, total)):
        f = i / fade if i < fade else (total - 1 - i) / fade
        b = i * ch
        for c in range(ch):
            out[b + c] = int(out[b + c] * f)
    data = out.tobytes()
    with wave.open(wav_out, "wb") as w:
        w.setnchannels(ch); w.setsampwidth(2); w.setframerate(rate); w.writeframes(data)
    return total / rate, hashlib.sha256(data).hexdigest()


def encode(wav, m4a):
    subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "128000", wav, m4a], check=True, capture_output=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--catalog", default=os.path.join(HERE, "catalog.json"))
    args = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    catalog = json.load(open(args.catalog))
    seen_hash, seen_name, report = {}, {}, []
    for e in catalog["tracks"]:
        key = e["key"]
        if args.only and key not in args.only:
            continue
        row = {"key": key, "title": e["title"], "creator": e["creator"]}
        name = norm(e["title"]) + "|" + norm(e["creator"])
        if name in seen_name:
            row.update(status="duplicate", of=seen_name[name]); report.append(row); continue
        if not e.get("rehost_ok", False):
            row.update(status="skipped", reason="licence doesn't allow re-hosting"); report.append(row); continue
        try:
            ext = os.path.splitext(e["download_url"].split("?")[0])[1].lower() or ".audio"
            cached = os.path.join(CACHE, key + ext)
            was_cached = os.path.exists(cached)
            need = None
            if ext == ".mp3":  # 320 kb/s: (start + clip + 5 s) seconds of it
                need = int((float(e.get("start_s", 0)) + float(e.get("max_s", MAX_S)) + 5) * 320000 / 8)
            src = fetch(e["download_url"], cached, need)
            if not was_cached:
                time.sleep(1.0)  # be gentle with the source
            with tempfile.TemporaryDirectory() as t:
                full, cut, m4a = os.path.join(t, "full.wav"), os.path.join(t, "cut.wav"), os.path.join(t, "loop.m4a")
                decode(src, full)
                dur, h = clip(full, cut, float(e.get("start_s", 0)), float(e.get("max_s", MAX_S)))
                if h in seen_hash:
                    row.update(status="duplicate", of=seen_hash[h]); report.append(row); continue
                encode(cut, m4a)
                manifest = {"title": e["title"][:80], "audio": "loop.m4a", "duration_ms": int(dur * 1000), "kind": "library",
                            "artist": e.get("creator", ""), "license": e.get("license", ""), "attribution": e.get("attribution", ""),
                            "source_url": e.get("page_url", ""), "tags": e.get("tags", [])[:8]}
                if e.get("bpm"):
                    manifest["bpm"] = int(round(e["bpm"]))
                zpath = os.path.join(OUT, key + ".zip")
                with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
                    z.writestr("manifest.json", json.dumps(manifest))
                    z.write(m4a, "loop.m4a")
            seen_hash[h] = key
            seen_name[name] = key
            row.update(status="built", zip=os.path.relpath(zpath, HERE), duration_ms=manifest["duration_ms"],
                       bytes=os.path.getsize(zpath), audio_sha256=h)
        except Exception as ex:  # one bad track never stops the build
            row.update(status="failed", reason=str(ex)[:200])
        report.append(row)
        print(f"{row['status']:>9}  {key}  {row.get('reason', '')}", flush=True)
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), indent=1)
    counts = {}
    for r in report:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print("summary:", counts)


if __name__ == "__main__":
    sys.exit(main())
