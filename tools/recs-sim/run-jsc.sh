#!/bin/bash
# Runs the recommender checks inside JavaScriptCore, the engine GameRecommender.swift uses.
# macOS only (uses the system jsc).
#
#   tools/recs-sim/run-jsc.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
JSC="${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}"
exec "$JSC" "$ROOT/FacebookClone/Bubbles/Recommend/game-recs.js" "$HERE/checks.js" "$HERE/jsc-main.js"
