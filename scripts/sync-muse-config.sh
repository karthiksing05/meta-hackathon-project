#!/bin/sh
# Writes FacebookClone/Bubbles/Studio/MuseConfig.json from MUSE_API_KEY in .env so the app can call
# Muse. The JSON file is gitignored. Run it once after cloning, and again if the key changes.
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  echo "No .env file. Add a line: MUSE_API_KEY=your-key" >&2
  exit 1
fi
KEY=$(sed -n 's/^MUSE_API_KEY=//p' .env | head -n 1 | tr -d '"'"'"' \r')
if [ -z "$KEY" ]; then
  echo "MUSE_API_KEY is empty in .env" >&2
  exit 1
fi
OUT=FacebookClone/Bubbles/Studio/MuseConfig.json
umask 077
printf '{\n  "api_key": "%s",\n  "base_url": "https://api.meta.ai/v1",\n  "planner_model": "muse-wonder-1.0",\n  "fast_model": "muse-ember-1.0",\n  "image_model": "muse-image-1.0",\n  "vision_model": "muse-spark-1.3"\n}\n' "$KEY" > "$OUT"
echo "Wrote $OUT (gitignored)."
