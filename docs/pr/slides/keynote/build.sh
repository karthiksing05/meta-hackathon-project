#!/bin/sh
# Builds the Keynote deck from png/slide-N.png and notes.md, one full-bleed picture per slide plus speaker notes.
# Slides 5 and 6 get the real NYT/Krillion and Reels screenshots as overlays. Those are copyrighted, so they
# never go in the repo: point REF at a folder outside it (default: game-backups/reference next to the main checkout).
# Usage: ./render.sh && keynote/build.sh [out.key]
# Close other Keynote documents first. A full rebuild drops any Live Video boxes; re-insert them afterwards
# (Insert > Live Video > the iPhone) on slides 10 and 11, then run: osascript keynote/snap-phones.applescript
set -e
cd "$(dirname "$0")/.."
HERE="$PWD"
REF="${REF:-$(dirname "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")")/game-backups/reference}"
OUT="${1:-$HOME/Desktop/Muse Curios pitch.key}"
STAGE="$(mktemp -d)"
N=$(grep -c '<section class="slide' deck.html)
python3 - "$HERE/notes.md" "$STAGE" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
for m in re.finditer(r'^## (\d+)\n(.*?)(?=^## |\Z)', s, re.S | re.M):
    open(f'{sys.argv[2]}/notes{m.group(1)}.txt', 'w').write(m.group(2).strip())
PY
cat > "$STAGE/build.applescript" <<AS
on readNotes(p)
	try
		return read POSIX file p as «class utf8»
	on error
		return ""
	end try
end readNotes
on addPic(s, f, x, y, w, h)
	try
		tell application "Keynote" to tell s to make new image with properties {file:POSIX file f, position:{x, y}, width:w, height:h}
	end try
end addPic
tell application "Keynote"
	activate
	set doc to make new document with properties {document theme:theme "White", width:1920, height:1080}
	repeat with k from 1 to $N
		if k is 1 then
			set s to slide 1 of doc
		else
			set s to make new slide at end of slides of doc
		end if
		set base slide of s to master slide "Blank" of doc
		tell s to make new image with properties {file:POSIX file ("$HERE/png/slide-" & k & ".png"), position:{0, 0}, width:1920, height:1080}
		set presenter notes of s to my readNotes("$STAGE/notes" & k & ".txt")
		if k is 5 then
			my addPic(s, "$REF/nyt/play-wordle.png", 826, 259, 194, 434)
			my addPic(s, "$REF/nyt/play-connections.png", 1048, 259, 194, 434)
			my addPic(s, "$REF/nyt/play-strands.png", 1270, 259, 194, 434)
			my addPic(s, "$REF/krillion/play.png", 1514, 259, 194, 434)
		end if
		if k is 6 then
			my addPic(s, "$REF/reels/slide/A.png", 150, 249, 246, 533)
			my addPic(s, "$REF/reels/slide/B.png", 446, 249, 246, 533)
			my addPic(s, "$REF/reels/slide/C.png", 742, 249, 246, 533)
		end if
	end repeat
	save doc in POSIX file "$OUT"
end tell
AS
osascript "$STAGE/build.applescript"
echo "built $N slides into $OUT"
