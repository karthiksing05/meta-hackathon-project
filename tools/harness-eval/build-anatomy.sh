#!/bin/sh
# Builds anatomy-helper (tools/harness-eval/anatomy/main.swift) with the Studio sources and the game
# anatomy files (GameAnatomy.swift, GameAnatomyMuse.swift, MuseAnatomyPrompts.swift).
#
#   tools/harness-eval/build-anatomy.sh [OUTPUT_DIR]       (default tools/harness-eval/.build)
#
# The anatomy files come from FacebookClone/Bubbles/Studio when the branch has them. Otherwise set
# ANATOMY_SRC to a folder that holds the three files, for example a snapshot of a branch that
# isn't merged yet.
set -eu
cd "$(dirname "$0")/../.."
OUT="${1:-tools/harness-eval/.build}"
mkdir -p "$OUT"
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode-26.6.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer
fi
EXTRA=""
if [ ! -f FacebookClone/Bubbles/Studio/GameAnatomy.swift ]; then
  SRC="${ANATOMY_SRC:?no GameAnatomy.swift in FacebookClone/Bubbles/Studio; set ANATOMY_SRC}"
  EXTRA="$SRC/GameAnatomy.swift $SRC/GameAnatomyMuse.swift $SRC/MuseAnatomyPrompts.swift"
fi
PRODUCT=""
[ -f FacebookClone/DesignSystem/ProductName.swift ] && PRODUCT=FacebookClone/DesignSystem/ProductName.swift
# shellcheck disable=SC2086
xcrun --sdk macosx swiftc \
  -swift-version 5 \
  ${OPT:--Onone} \
  -module-name AnatomyHelper \
  -framework JavaScriptCore \
  -framework WebKit \
  FacebookClone/Bubbles/Models/*.swift \
  FacebookClone/Bubbles/Studio/*.swift \
  $PRODUCT $EXTRA \
  tools/harness-eval/anatomy/main.swift \
  -o "$OUT/anatomy-helper"
echo "Built $OUT/anatomy-helper"
