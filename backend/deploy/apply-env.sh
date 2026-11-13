#!/bin/sh
# apply-env.sh <env-file>: merge KEY=VALUE lines read from stdin into <env-file>.
# A key already in the file is replaced in place, a new key is appended, every other line is kept (so the
# server's own secrets, like the Mongo password and JWT_SECRET, are never touched). Blank lines and # comments
# in the input are ignored. The file stays root-only (umask 077) and is replaced atomically.
set -eu
f=${1:?usage: apply-env.sh <env-file>}
umask 077
new=$(mktemp)
trap 'rm -f "$new"' EXIT
grep -E '^[A-Za-z_][A-Za-z0-9_]*=' | tr -d '\r' > "$new" || true
[ -f "$f" ] || : > "$f"
awk '
  NR==FNR { k=$0; sub(/=.*/,"",k); if (!(k in v)) order[++n]=k; v[k]=$0; next }
  { k=$0; sub(/=.*/,"",k)
    if (k in v) { if (!(k in done)) { print v[k]; done[k]=1 } ; next }
    print }
  END { for (i=1;i<=n;i++) if (!(order[i] in done)) print v[order[i]] }
' "$new" "$f" > "$f.new"
mv "$f.new" "$f"
echo "$f: applied $(wc -l < "$new" | tr -d ' ') setting(s)"
