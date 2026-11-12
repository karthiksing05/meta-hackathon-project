#!/usr/bin/env bash
# Builds the wasm runtime for the player and the native sgtool CLI used by the server.
set -euo pipefail

export PATH="/opt/homebrew/opt/rustup/bin:$HOME/.cargo/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/runtime"

now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

T0=$(now_ms)
wasm-pack build --target web --release --out-dir ../player/pkg -- --features wasm
T1=$(now_ms)

WASM="$ROOT/player/pkg/sg_runtime_bg.wasm"
if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals \
    "$WASM" -o "$WASM.opt" && mv "$WASM.opt" "$WASM"
else
  echo "wasm-opt not found; skipping -Oz pass"
fi
T2=$(now_ms)

cargo build --release --bin sgtool
T3=$(now_ms)

RAW=$(wc -c < "$WASM" | tr -d ' ')
GZ=$(gzip -9 -c "$WASM" | wc -c | tr -d ' ')
echo "wasm size:  ${RAW} bytes ($((RAW / 1024)) KiB), gzip ${GZ} bytes ($((GZ / 1024)) KiB)"
echo "timings:    wasm-pack $((T1 - T0)) ms, wasm-opt $((T2 - T1)) ms, sgtool $((T3 - T2)) ms"
echo "sgtool:     $ROOT/runtime/target/release/sgtool"
