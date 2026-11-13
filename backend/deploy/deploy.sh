#!/usr/bin/env bash
# Runs ON THE SERVER (called over SSH by the GitHub Actions workflow, or by hand).
#
#   deploy.sh deploy <image-tag>    deploy a commit SHA; roll back automatically if /readyz fails
#   deploy.sh rollback              redeploy the previously deployed tag
#   deploy.sh seed                  put the demo world on the server (people, friends, Group, seed games, scores)
#   deploy.sh restart-generator     recreate the generator (after changing generator.env)
#   deploy.sh status                show the running tags
#
# Only the api and games containers are touched. Mongo, the data directories and cloudflared are
# never restarted, recreated or wiped here. Database indexes are a separate step (dbinit.sh).
set -euo pipefail

BASE=/srv/game-platform
APP=$BASE/app
STATE=$BASE/state
REGISTRY_PREFIX_FILE=/etc/game-platform/registry   # e.g. ghcr.io/your-github-owner
COMPOSE=(docker compose -f "$APP/docker-compose.prod.yml")
READY_URL=http://127.0.0.1:8080/readyz
GAMES_URL=http://127.0.0.1:8081/healthz
GENERATOR_URL=http://127.0.0.1:8090/healthz
CHECK_GENERATOR=0
WAIT_SECONDS=${WAIT_SECONDS:-90}

mkdir -p "$STATE"
PREFIX=$(tr -d '[:space:]' < "$REGISTRY_PREFIX_FILE")
[ -n "$PREFIX" ] || { echo "empty $REGISTRY_PREFIX_FILE" >&2; exit 2; }

wait_ready() {
  local deadline=$((SECONDS + WAIT_SECONDS))
  while [ $SECONDS -lt $deadline ]; do
    if curl -fsS --max-time 3 "$READY_URL" >/dev/null 2>&1 && curl -fsS --max-time 3 "$GAMES_URL" >/dev/null 2>&1 \
       && { [ "$CHECK_GENERATOR" != 1 ] || curl -fsS --max-time 3 "$GENERATOR_URL" >/dev/null 2>&1; }; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# up_tag <tag> [--pull]: point api, games and the generator at <tag> and (re)create only those services.
# Tags from before the generator existed have no generator image: then it is left as it is.
up_tag() {
  local tag=$1
  local services=(api games)
  export API_IMAGE="$PREFIX/bubbles-api:$tag" GAMES_IMAGE="$PREFIX/bubbles-games:$tag" GENERATOR_IMAGE="$PREFIX/bubbles-generator:$tag"
  if [ "${2:-}" = "--pull" ]; then
    "${COMPOSE[@]}" pull api games
    "${COMPOSE[@]}" pull generator || echo "no generator image for $tag" >&2
  fi
  CHECK_GENERATOR=0
  if docker image inspect "$GENERATOR_IMAGE" >/dev/null 2>&1; then
    services+=(generator)
    CHECK_GENERATOR=1
  fi
  "${COMPOSE[@]}" up -d --no-deps "${services[@]}"
}

cmd=${1:-}
case "$cmd" in
  deploy)
    tag=${2:?usage: deploy.sh deploy <image-tag>}
    [[ "$tag" =~ ^[A-Za-z0-9_.-]{1,128}$ ]] || { echo "bad tag" >&2; exit 2; }
    prev=$(cat "$STATE/current_tag" 2>/dev/null || true)
    echo "deploying $tag (previous: ${prev:-none})"
    up_tag "$tag" --pull
    if wait_ready; then
      [ -n "$prev" ] && [ "$prev" != "$tag" ] && echo "$prev" > "$STATE/previous_tag"
      echo "$tag" > "$STATE/current_tag"
      echo "deployed $tag: ready"
      exit 0
    fi
    echo "readiness check FAILED for $tag" >&2
    "${COMPOSE[@]}" logs --tail 50 api games >&2 || true
    if [ -n "$prev" ]; then
      echo "rolling back to $prev" >&2
      up_tag "$prev"
      if wait_ready; then echo "rolled back to $prev: ready" >&2; else echo "ROLLBACK ALSO FAILED: investigate manually" >&2; fi
    else
      echo "no previous version to roll back to" >&2
    fi
    exit 1
    ;;
  rollback)
    prev=$(cat "$STATE/previous_tag" 2>/dev/null || true)
    [ -n "$prev" ] || { echo "no previous tag recorded" >&2; exit 1; }
    cur=$(cat "$STATE/current_tag" 2>/dev/null || true)
    up_tag "$prev" --pull
    wait_ready || { echo "rollback to $prev is not ready" >&2; exit 1; }
    echo "$prev" > "$STATE/current_tag"
    [ -n "$cur" ] && echo "$cur" > "$STATE/previous_tag"
    echo "rolled back to $prev"
    ;;
  seed)
    # Put the demo world on the server (people, friends, a Group and an Event, the seed games and their scores).
    # Safe to run again. Uses the API image of the deployed tag, with the API's environment.
    tag=$(cat "$STATE/current_tag" 2>/dev/null || true)
    [ -n "$tag" ] || { echo "no deployed tag recorded" >&2; exit 1; }
    export API_IMAGE="$PREFIX/bubbles-api:$tag" GAMES_IMAGE="$PREFIX/bubbles-games:$tag" GENERATOR_IMAGE="$PREFIX/bubbles-generator:$tag"
    "${COMPOSE[@]}" run --rm --no-deps --entrypoint /app/seed api
    ;;
  restart-generator)
    # Recreate the generator so it re-reads /etc/game-platform/generator.env (e.g. after adding the Muse key).
    tag=$(cat "$STATE/current_tag" 2>/dev/null || true)
    [ -n "$tag" ] || { echo "no deployed tag recorded" >&2; exit 1; }
    export API_IMAGE="$PREFIX/bubbles-api:$tag" GAMES_IMAGE="$PREFIX/bubbles-games:$tag" GENERATOR_IMAGE="$PREFIX/bubbles-generator:$tag"
    "${COMPOSE[@]}" up -d --no-deps --force-recreate generator
    for _ in $(seq 1 30); do
      curl -fsS --max-time 3 "$GENERATOR_URL" && { echo; exit 0; }
      sleep 2
    done
    echo "generator did not become healthy" >&2
    exit 1
    ;;
  status)
    echo "current:  $(cat "$STATE/current_tag" 2>/dev/null || echo none)"
    echo "previous: $(cat "$STATE/previous_tag" 2>/dev/null || echo none)"
    "${COMPOSE[@]}" ps
    ;;
  *)
    echo "usage: deploy.sh deploy <tag> | rollback | status" >&2
    exit 2
    ;;
esac
