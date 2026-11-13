#!/usr/bin/env bash
# Backups, independent of application deployments. Run from cron/systemd (see deploy/systemd/).
#
#   backup.sh mongo    gzip'd mongodump archive of the whole instance
#   backup.sh games    tarball of /srv/game-platform/data/games (published + private source)
#
# Writes to /srv/game-platform/backups and keeps the newest $KEEP of each kind. Copy that directory
# off the server too (a backup on the same disk does not survive losing the disk).
set -euo pipefail
OUT=/srv/game-platform/backups
KEEP=${KEEP:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$OUT"
umask 077

case "${1:-}" in
  mongo)
    f="$OUT/mongo-$STAMP.archive.gz"
    # Credentials come from the container's own environment, never from this script or the process list.
    docker exec game-platform-mongo-1 sh -c \
      'mongodump --quiet --uri="mongodb://$MONGO_INITDB_ROOT_USERNAME:$MONGO_INITDB_ROOT_PASSWORD@127.0.0.1:27017/?authSource=admin" --archive --gzip' \
      > "$f.partial"
    mv "$f.partial" "$f"
    ls -1t "$OUT"/mongo-*.archive.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
    echo "wrote $f"
    ;;
  games)
    f="$OUT/games-$STAMP.tar.gz"
    tar -C /srv/game-platform/data -czf "$f.partial" --exclude='games/tmp' games
    mv "$f.partial" "$f"
    ls -1t "$OUT"/games-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
    echo "wrote $f"
    ;;
  *)
    echo "usage: backup.sh mongo|games" >&2
    exit 2
    ;;
esac
