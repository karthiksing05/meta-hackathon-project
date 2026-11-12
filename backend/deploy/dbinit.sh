#!/usr/bin/env bash
# Creates/updates MongoDB indexes. Run by hand on the server after the first deploy and whenever a
# release changes internal/store/indexes.go. It is idempotent and is NOT part of routine deploys.
#
#   /srv/game-platform/app/dbinit.sh
set -euo pipefail
APP=/srv/game-platform/app
PREFIX=$(tr -d '[:space:]' < /etc/game-platform/registry)
TAG=${1:-$(cat /srv/game-platform/state/current_tag)}
export API_IMAGE="$PREFIX/bubbles-api:$TAG" GAMES_IMAGE="$PREFIX/bubbles-games:$TAG"
docker compose -f "$APP/docker-compose.prod.yml" run --rm --no-deps --entrypoint /app/dbinit api
