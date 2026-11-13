#!/usr/bin/env bash
# Creates/updates MongoDB indexes and loads the game catalog. The deploy workflow runs it after every deploy (it is
# idempotent: it only adds what is missing). You can also run it by hand on the server, for example after a release
# that changes internal/store/indexes.go if the workflow step failed.
#
#   /srv/game-platform/app/dbinit.sh
set -euo pipefail
APP=/srv/game-platform/app
PREFIX=$(tr -d '[:space:]' < /etc/game-platform/registry)
TAG=${1:-$(cat /srv/game-platform/state/current_tag)}
export API_IMAGE="$PREFIX/bubbles-api:$TAG" GAMES_IMAGE="$PREFIX/bubbles-games:$TAG" GENERATOR_IMAGE="$PREFIX/bubbles-generator:$TAG"
docker compose -f "$APP/docker-compose.prod.yml" run --rm --no-deps --entrypoint /app/dbinit api
