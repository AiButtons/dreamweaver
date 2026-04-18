#!/usr/bin/env bash
# Stops the local dreamweaver dev stack launched by start_storyboard_local.sh.
# Reads $REPO/.runlogs/storyboard-local-processes.json, kills each root pid and
# its descendants, and as a last resort clears any lingering port listeners.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$REPO_ROOT/.runlogs/storyboard-local-processes.json"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No process metadata file found at $PID_FILE"
  exit 0
fi

descendants() {
  # Recursively collect child pids of $1.
  local parent="$1" children pid
  children="$(pgrep -P "$parent" 2>/dev/null || true)"
  for pid in $children; do
    echo "$pid"
    descendants "$pid"
  done
}

kill_tree() {
  local root="$1" tree pid
  tree="$(echo "$root"; descendants "$root")"
  # Reverse order so leaves die first.
  for pid in $(echo "$tree" | awk 'NF' | awk '!seen[$0]++' | tail -r 2>/dev/null || echo "$tree" | awk 'NF' | awk '!seen[$0]++' | tac); do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Give processes a moment, then SIGKILL anything still alive.
  sleep 0.5
  for pid in $(echo "$tree" | awk 'NF' | awk '!seen[$0]++'); do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

# Parse JSON with Python (no jq dependency).
entries="$(python3 - "$PID_FILE" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for entry in data:
    print(f"{entry['name']}|{entry['pid']}|{entry.get('port',0)}")
PY
)"

while IFS='|' read -r name pid port; do
  [[ -z "${pid:-}" ]] && continue
  if kill -0 "$pid" 2>/dev/null; then
    kill_tree "$pid"
    echo "Stopped $name process tree (root pid=$pid)"
  else
    echo "Process tree not running: $name (root pid=$pid)"
  fi

  # Clean up any lingering listener on the tracked port.
  if [[ "${port:-0}" != "0" ]]; then
    owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    if [[ -n "$owner" ]]; then
      kill -9 "$owner" 2>/dev/null || true
      echo "Stopped lingering listener on port $port (pid=$owner)"
    fi
  fi
done <<< "$entries"

rm -f "$PID_FILE"
