#!/bin/zsh
# The kit screenshot set (390x844 @2x, headless Chrome, demo mode with the built-in bot):
# every seed mid-game, every seed's card poster, night-bloom variants, and each kit in three looks.
#   tools/kits-tests/shots-final.sh <out-dir> [looks...]   (default looks: paper pixel neon)
set -e
here=${0:A:h}
out=$1; shift
looks=(${@:-paper pixel neon})
s=$here/shoot.sh
mkdir -p $out/seeds $out/posters $out/dark $out/looks
zsh $s $out/seeds sort-the-city:sort-the-city:10 fog-or-sun-ask:newinsf-fog-or-sun:5.4 fog-or-sun-reveal:newinsf-fog-or-sun:7.6 \
  cable-car-catch:cable-car-catch:5 sourdough-stack:sourdough-stack:9 bay-bubbles:bay-bubbles:25 \
  picnic-this-or-that:picnic-this-or-that:6 trivia-thursday-sf:trivia-thursday-sf:7 >/dev/null
zsh $s $out/posters sort-the-city:sort-the-city:0::::poster=1 newinsf-fog-or-sun:newinsf-fog-or-sun:0::::poster=1 \
  cable-car-catch:cable-car-catch:0::::poster=1 sourdough-stack:sourdough-stack:0::::poster=1 bay-bubbles:bay-bubbles:0::::poster=1 \
  picnic-this-or-that:picnic-this-or-that:0::::poster=1 trivia-thursday-sf:trivia-thursday-sf:0::::poster=1 >/dev/null
zsh $s $out/dark group::8:0.86:1:group:dark=1 answer::7.6:0.86:1:answer:dark=1 time::5:0.86:1:time:dark=1 merge::20:0.86:1:merge:dark=1 >/dev/null
for lk in $looks; do
  zsh $s $out/looks group-${lk}:sort-the-city:10::::look=${lk} answer-${lk}:newinsf-fog-or-sun:7.6::::look=${lk} \
    time-catch-${lk}:cable-car-catch:5::::look=${lk} time-stack-${lk}:sourdough-stack:9::::look=${lk} merge-${lk}:bay-bubbles:25::::look=${lk} >/dev/null
done
ls $out/*/*.png | wc -l
