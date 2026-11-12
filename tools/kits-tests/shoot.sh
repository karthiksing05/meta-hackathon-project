#!/bin/zsh
# Headless Chrome stills of kit Bubbles in demo mode at 390x844 (@2x), on the real runtime + host.
#   tools/kits-tests/shoot.sh <out-dir> name:seed:t[:skill[:botseed[:formula[:extra-query]]]] ...
# Examples:
#   tools/kits-tests/shoot.sh /tmp/shots bay:bay-bubbles:12 fog:newinsf-fog-or-sun:3.5:0.8:2
#   tools/kits-tests/shoot.sh /tmp/shots merge-dark::10:0.8:1:merge:dark=1
set -e
here=${0:A:h}
out=$1; shift
mkdir -p "$out"
prof=$(mktemp -d "${TMPDIR:-/tmp}/kits-chrome.XXXXXX")
trap 'rm -rf "$prof"' EXIT
page=$here/preview.html
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for spec in "$@"; do
  IFS=: read -r name seed t skill botseed formula extra <<< "$spec"
  qs="t=${t:-2}&skill=${skill:-0.86}"
  [[ -n "$botseed" ]] && qs="$qs&botseed=$botseed"
  if [[ -n "$formula" ]]; then qs="$qs&formula=$formula"; else qs="$qs&seed=$seed"; fi
  [[ -n "$extra" ]] && qs="$qs&$extra"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$prof" --allow-file-access-from-files \
    --window-size=390,844 --force-device-scale-factor=2 --virtual-time-budget=4000 \
    --screenshot="$out/$name.png" "file://$page?$qs" >/dev/null 2>&1 || echo "chrome failed for $name"
  echo "$out/$name.png"
done
