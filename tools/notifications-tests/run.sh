#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
NOTIFICATION_TEST_DIR=$(mktemp -d "${TMPDIR:-/tmp}/notification-tests.XXXXXX")
trap 'rm -rf "$NOTIFICATION_TEST_DIR"' EXIT
# Compile the production error type, without pulling in unrelated app-only model types.
python3 - "$NOTIFICATION_TEST_DIR/APIError.swift" <<'PY'
from pathlib import Path
import sys
s = Path('FacebookClone/Bubbles/API/GamesAPI.swift').read_text()
start = s.index('enum GamesAPIError:')
end = s.index('\nenum GamesAPIConfig', start)
Path(sys.argv[1]).write_text('import Foundation\n' + s[start:end])
PY
swiftc -parse-as-library -module-cache-path "$NOTIFICATION_TEST_DIR/cache" \
  FacebookClone/Features/Notifications/Games/GameNotificationModels.swift \
  FacebookClone/Features/Notifications/Games/GameNotificationInbox.swift \
  "$NOTIFICATION_TEST_DIR/APIError.swift" tools/notifications-tests/run.swift \
  -o "$NOTIFICATION_TEST_DIR/checks"
"$NOTIFICATION_TEST_DIR/checks"
