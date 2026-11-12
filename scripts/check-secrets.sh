#!/bin/sh
# Stops a commit that would publish the Muse API key. Run it after `git add`, before every commit:
#
#   scripts/check-secrets.sh
#
# Exits 1 if .env or MuseConfig.json is staged, or if the staged changes contain the key from .env.
# It never prints the key.
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

status=0
staged=$(git diff --cached --name-only)
for f in .env FacebookClone/Bubbles/Studio/MuseConfig.json; do
  if printf '%s\n' "$staged" | grep -qxF "$f"; then
    echo "STOP: $f is staged. Unstage it with: git restore --staged $f" >&2
    status=1
  fi
done

if [ -f .env ]; then
  KEY=$(sed -n 's/^MUSE_API_KEY=//p' .env | head -n 1 | tr -d '"'"'"' \r')
  if [ -n "$KEY" ] && git diff --cached | grep -qF -- "$KEY"; then
    echo "STOP: the staged changes contain the Muse API key." >&2
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "No secrets in the staged changes."
fi
exit "$status"
