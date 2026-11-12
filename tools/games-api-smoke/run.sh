#!/bin/zsh
# Compiles the wire models with a tiny main and checks the live API (read-only, no tokens).
set -e
cd "$(dirname "$0")/../.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode-26.6.app/Contents/Developer}
out=$(mktemp -d)
swiftc -o "$out/smoke" FacebookClone/Bubbles/API/GamesAPIModels.swift tools/games-api-smoke/main.swift
"$out/smoke" "$@"
