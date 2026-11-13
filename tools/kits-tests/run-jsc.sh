#!/bin/bash
# Runs the formula kit tests inside JavaScriptCore (the engine the app uses): no DOM, files loaded
# in the runtime's order (bubble-runtime.js, bubble-kit-common.js, then every kit by name).
#
#   tools/kits-tests/run-jsc.sh [--quick] [--formula a,b]
# Prints a FINGERPRINT line; run-node.js prints the same one when both engines agree bit for bit.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WEB="$ROOT/FacebookClone/Bubbles/Runtime/web"
SEEDS="$ROOT/FacebookClone/Bubbles/Seeds"
JSC="${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}"

FILES=("$WEB/bubble-runtime.js" "$WEB/bubble-kit-common.js")
while IFS= read -r f; do
  [ "$(basename "$f")" = "bubble-kit-common.js" ] || FILES+=("$f")
done < <(ls "$WEB"/bubble-kit-*.js | LC_ALL=C sort)
SUITES=()
while IFS= read -r f; do SUITES+=("$f"); done < <(ls "$HERE"/suite-*.js 2>/dev/null | LC_ALL=C sort)
SEED_FILES=()
while IFS= read -r f; do SEED_FILES+=("$f"); done < <(ls "$SEEDS"/bubble-seed-*.json | LC_ALL=C sort)

exec "$JSC" "${FILES[@]}" ${SUITES[@]+"${SUITES[@]}"} "$HERE/kits-tests-core.js" "$HERE/jsc-main.js" -- "$@" --seeds "${SEED_FILES[@]}"
