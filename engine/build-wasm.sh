#!/usr/bin/env bash
# Builds the engine to WebAssembly for the browser shell.
#   engine/web/pkg/microgame.wasm   the engine (plain C ABI, see README)
#   engine/web/games/*.json         copies of engine/fixtures and engine/examples + index.json
#
# MG_WASM_OPT=s|z trades speed for size (default: the profile's opt-level 3).
set -euo pipefail

cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/rustup/bin:$PATH"
TARGET_DIR="${CARGO_TARGET_DIR:-target}"

extra=()
if [ -n "${MG_WASM_OPT:-}" ]; then
  extra=(--config "profile.wasm.opt-level=\"$MG_WASM_OPT\"")
fi
cargo build -p mg-wasm --target wasm32-unknown-unknown --profile wasm ${extra[@]+"${extra[@]}"}

mkdir -p web/pkg web/games
cp "$TARGET_DIR/wasm32-unknown-unknown/wasm/mg_wasm.wasm" web/pkg/microgame.wasm

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int \
    web/pkg/microgame.wasm -o web/pkg/microgame.wasm
  echo "wasm-opt: applied -O3"
else
  echo "wasm-opt: not found, skipped"
fi

# Fixtures and examples for the shell's picker (not replay scripts).
rm -f web/games/*.json
names=()
for f in fixtures/*.json examples/*.json; do
  case "$f" in *.replay.json) continue ;; esac
  cp "$f" web/games/
  names+=("\"$(basename "$f")\"")
done
(IFS=,; echo "[${names[*]}]") > web/games/index.json

bytes=$(wc -c < web/pkg/microgame.wasm | tr -d ' ')
if command -v gzip >/dev/null 2>&1; then
  gz=$(gzip -9 -c web/pkg/microgame.wasm | wc -c | tr -d ' ')
  echo "web/pkg/microgame.wasm: $bytes bytes ($((bytes / 1024)) KiB), gzip -9: $gz bytes ($((gz / 1024)) KiB)"
else
  echo "web/pkg/microgame.wasm: $bytes bytes ($((bytes / 1024)) KiB)"
fi
