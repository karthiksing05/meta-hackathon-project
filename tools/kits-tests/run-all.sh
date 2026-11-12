#!/bin/bash
# Runs the kit tests in Node and in JavaScriptCore and checks both engines print the same
# FINGERPRINT (same scores, ticks, events, input logs and merge physics state, bit for bit).
#   tools/kits-tests/run-all.sh [--quick]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
node "$HERE/run-node.js" "$@" > "${TMPDIR:-/tmp}/kits-node.$$" 2>&1; n=$?
"$HERE/run-jsc.sh" "$@" > "${TMPDIR:-/tmp}/kits-jsc.$$" 2>&1; j=$?
fn=$(grep -o 'FINGERPRINT [0-9a-f]*' "${TMPDIR:-/tmp}/kits-node.$$" || true)
fj=$(grep -o 'FINGERPRINT [0-9a-f]*' "${TMPDIR:-/tmp}/kits-jsc.$$" || true)
tail -4 "${TMPDIR:-/tmp}/kits-node.$$" | sed 's/^/node: /'
tail -4 "${TMPDIR:-/tmp}/kits-jsc.$$" | sed 's/^/jsc:  /'
rm -f "${TMPDIR:-/tmp}/kits-node.$$" "${TMPDIR:-/tmp}/kits-jsc.$$"
if [ $n -ne 0 ] || [ $j -ne 0 ]; then echo "FAILED (node $n, jsc $j)"; exit 1; fi
if [ -z "$fn" ] || [ "$fn" != "$fj" ]; then echo "ENGINES DISAGREE: node '$fn' vs jsc '$fj'"; exit 1; fi
echo "OK: Node and jsc agree ($fn)"
