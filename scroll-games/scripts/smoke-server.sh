#!/bin/sh
# Starts the Scroll Games server, curls the main read endpoints, stops it.
set -e
cd "$(dirname "$0")/../server"
PORT="${PORT:-8787}"
go build -o /tmp/sg-smoke-server ./cmd/server
SG_ADDR=":$PORT" SG_DATA="$(mktemp -d)" /tmp/sg-smoke-server >/dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for _ in $(seq 1 50); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 0.1; done
for p in /api/health /api/me /api/groups "/api/media?group=g_lisbon" /api/feed /api/usage; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT$p")
  echo "$code $p"
  [ "$code" = 200 ] || exit 1
done
echo "smoke ok"
