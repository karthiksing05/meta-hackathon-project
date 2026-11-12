#!/bin/sh
# Builds the bubble-studio CLI (Muse Studio on macOS): the shared Bubble models and the Studio
# harness from the app, plus main.swift, linked with JavaScriptCore.
#
#   tools/bubble-studio/build.sh [OUTPUT_DIR]
#
# OUTPUT_DIR defaults to $BUBBLE_STUDIO_OUT, then tools/bubble-studio/.build (gitignored).
# Set OPT=-O for an optimized build.
set -eu
cd "$(dirname "$0")/../.."
OUT="${1:-${BUBBLE_STUDIO_OUT:-tools/bubble-studio/.build}}"
mkdir -p "$OUT"
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode-26.6.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer
fi
xcrun --sdk macosx swiftc \
  -swift-version 5 \
  ${OPT:--Onone} \
  -module-name BubbleStudio \
  -framework JavaScriptCore \
  FacebookClone/Bubbles/Models/*.swift \
  FacebookClone/Bubbles/Studio/*.swift \
  tools/bubble-studio/main.swift \
  -o "$OUT/bubble-studio"
echo "Built $OUT/bubble-studio"
