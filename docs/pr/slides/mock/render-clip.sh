#!/bin/sh
# Renders guess-clip.html to frames with headless Chrome, then guess-clip.gif (Pillow) and guess-clip.mp4 (make-mp4.swift).
set -e
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
rm -rf frames && mkdir frames
N=78   # 6.5 s at 12 fps
i=0
while [ $i -lt $N ]; do
  t=$(python3 -c "print(round($i/12,3))")
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=720,1280 \
    --screenshot="$PWD/frames/f$(printf %03d $i).png" "file://$PWD/guess-clip.html?t=$t" >/dev/null 2>&1
  i=$((i+1))
done
python3 - <<'PY'
import glob
from PIL import Image
fr = [Image.open(f).convert('RGB').resize((360, 640), Image.LANCZOS) for f in sorted(glob.glob('frames/f*.png'))]
fr[0].save('guess-clip.gif', save_all=True, append_images=fr[1:], duration=83, loop=0, optimize=True)
print('gif', len(fr), 'frames')
PY
swift make-mp4.swift frames guess-clip.mp4 12
rm -rf frames
