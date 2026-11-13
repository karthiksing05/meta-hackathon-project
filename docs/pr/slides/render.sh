#!/bin/sh
# Exports deck.html to png/slide-N.png (1920x1080) and deck.pdf with headless Chrome.
set -e
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
N=$(grep -c '<section class="slide' deck.html)
mkdir -p png
for i in $(seq 1 "$N"); do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1920,1080 --virtual-time-budget=2000 \
    --screenshot="$PWD/png/slide-$i.png" "file://$PWD/deck.html#$i" >/dev/null 2>&1
done
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=2000 \
  --print-to-pdf="$PWD/deck.pdf" "file://$PWD/deck.html" >/dev/null 2>&1
echo "rendered $N slides to png/ and deck.pdf"
