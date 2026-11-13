#!/bin/sh
# Builds the Studio CLI for the eval: tools/bubble-studio/build.sh's sources plus
# FacebookClone/DesignSystem/ProductName.swift (OfflineComposer reads ProductName, and build.sh on
# beta-version d7b34e3 doesn't compile it yet). Same flags otherwise; the pipeline is unchanged.
#
#   tools/harness-eval/build-cli.sh [OUTPUT_DIR]     (default tools/harness-eval/.build, gitignored)
set -eu
cd "$(dirname "$0")/../.."
OUT="${1:-tools/harness-eval/.build}"
mkdir -p "$OUT"
if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode-26.6.app/Contents/Developer ]; then
  export DEVELOPER_DIR=/Applications/Xcode-26.6.app/Contents/Developer
fi
xcrun --sdk macosx swiftc \
  -swift-version 5 \
  ${OPT:--Onone} \
  -module-name BubbleStudio \
  -framework JavaScriptCore \
  -framework WebKit \
  FacebookClone/Bubbles/Models/*.swift \
  FacebookClone/Bubbles/Studio/*.swift \
  FacebookClone/DesignSystem/ProductName.swift \
  tools/bubble-studio/main.swift \
  tools/bubble-studio/microgame.swift \
  -o "$OUT/bubble-studio"
echo "Built $OUT/bubble-studio"
