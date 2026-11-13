#!/bin/bash
# Runs the shared runtime checks inside JavaScriptCore, the engine BubbleJSRuntime uses in the app:
# no DOM, files loaded in the same order as BubbleJSRuntime.orderedScriptNames.
#
#   tools/runtime-tests/run-jsc.sh [web dir] [seeds dir]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WEB="${1:-$ROOT/FacebookClone/Bubbles/Runtime/web}"
SEEDS="${2:-$ROOT/tools/game-fixtures}"
JSC="${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}"

FILES=("$WEB/bubble-runtime.js")
[ -f "$WEB/bubble-kit-common.js" ] && FILES+=("$WEB/bubble-kit-common.js")
while IFS= read -r f; do
  [ "$(basename "$f")" = "bubble-kit-common.js" ] || FILES+=("$f")
done < <(ls "$WEB"/bubble-kit-*.js | LC_ALL=C sort)

SEED_FILES=()
while IFS= read -r f; do SEED_FILES+=("$f"); done < <(ls "$SEEDS"/bubble-seed-*.json | LC_ALL=C sort)

exec "$JSC" "${FILES[@]}" "$HERE/checks.js" "$HERE/jsc-main.js" -- "$SEEDS/bubble-demo-world.json" "${SEED_FILES[@]}"
