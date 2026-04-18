#!/usr/bin/env bash
# Launches the three-tier dreamweaver local dev stack in the background:
#   - dreamweaver-backend (FastAPI)     default :8001
#   - storyboard-agent   (LangGraph dev) default :8123
#   - dreamweaver-frontend (Next.js)    default :3002
#
# Logs stream to $REPO/.runlogs/<service>-<timestamp>.{out,err}.log
# PIDs are persisted to $REPO/.runlogs/storyboard-local-processes.json.
#
# Usage: ./scripts/start_storyboard_local.sh [flags]
#   --skip-backend        Do not launch backend (use if you already have it)
#   --include-convex      Also run `bun run convex:dev` in the frontend
#   --langgraph-tunnel    Pass --tunnel to `langgraph dev`
#   --backend-port N      Override backend port (default 8001)
#   --langgraph-port N    Override langgraph port (default 8123)
#   --frontend-port N     Override frontend port (default 3002)

set -euo pipefail

SKIP_BACKEND=0
INCLUDE_CONVEX=0
LANGGRAPH_TUNNEL=""
BACKEND_PORT=8001
LANGGRAPH_PORT=8123
FRONTEND_PORT=3002

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-backend)       SKIP_BACKEND=1; shift ;;
    --include-convex)     INCLUDE_CONVEX=1; shift ;;
    --langgraph-tunnel)   LANGGRAPH_TUNNEL="--tunnel"; shift ;;
    --backend-port)       BACKEND_PORT="$2"; shift 2 ;;
    --langgraph-port)     LANGGRAPH_PORT="$2"; shift 2 ;;
    --frontend-port)      FRONTEND_PORT="$2"; shift 2 ;;
    -h|--help)
      sed -n '1,20p' "$0"; exit 0 ;;
    *)
      echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOGS_DIR="$REPO_ROOT/.runlogs"
mkdir -p "$LOGS_DIR"

PID_FILE="$LOGS_DIR/storyboard-local-processes.json"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

# Track services as parallel arrays (bash 3 compatible — macOS default).
SVC_NAMES=()
SVC_PIDS=()
SVC_CWDS=()
SVC_CMDS=()
SVC_OUTS=()
SVC_ERRS=()
SVC_PORTS=()

assert_port_free() {
  local port="$1" name="$2"
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    local pid
    pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t | head -1)"
    echo "port $port already in use by pid=$pid — cannot start $name" >&2
    exit 1
  fi
}

launch() {
  local name="$1" cwd="$2" port="$3" cmd="$4"
  local out="$LOGS_DIR/${name}-${TIMESTAMP}.out.log"
  local err="$LOGS_DIR/${name}-${TIMESTAMP}.err.log"
  (
    cd "$cwd"
    # shellcheck disable=SC2086
    exec bash -lc "$cmd"
  ) >"$out" 2>"$err" &
  local pid=$!
  SVC_NAMES+=("$name"); SVC_PIDS+=("$pid"); SVC_CWDS+=("$cwd")
  SVC_CMDS+=("$cmd");  SVC_OUTS+=("$out"); SVC_ERRS+=("$err")
  SVC_PORTS+=("$port")
}

# --- backend (uvicorn via uv) ---------------------------------------------
if [[ "$SKIP_BACKEND" -eq 0 ]]; then
  assert_port_free "$BACKEND_PORT" "backend"
  BACKEND_DIR="$REPO_ROOT/dreamweaver-backend"
  if [[ ! -f "$BACKEND_DIR/.env" ]]; then
    echo "missing $BACKEND_DIR/.env — create it before starting backend" >&2
    exit 1
  fi
  if command -v uv >/dev/null 2>&1; then
    BACKEND_CMD="PYTHONIOENCODING=utf8 PYTHONUTF8=1 uv run uvicorn main:app --reload --host 127.0.0.1 --port $BACKEND_PORT"
  else
    BACKEND_CMD="PYTHONIOENCODING=utf8 PYTHONUTF8=1 .venv/bin/python -m uvicorn main:app --reload --host 127.0.0.1 --port $BACKEND_PORT"
  fi
  launch "backend" "$BACKEND_DIR" "$BACKEND_PORT" "$BACKEND_CMD"
fi

# --- langgraph dev server --------------------------------------------------
assert_port_free "$LANGGRAPH_PORT" "langgraph"
AGENT_DIR="$REPO_ROOT/storyboard-agent"
if command -v uv >/dev/null 2>&1; then
  LG_CMD="PYTHONIOENCODING=utf8 PYTHONUTF8=1 uv run langgraph dev --no-browser --host 127.0.0.1 --port $LANGGRAPH_PORT $LANGGRAPH_TUNNEL"
elif [[ -x "$AGENT_DIR/.venv/bin/langgraph" ]]; then
  LG_CMD="PYTHONIOENCODING=utf8 PYTHONUTF8=1 .venv/bin/langgraph dev --no-browser --host 127.0.0.1 --port $LANGGRAPH_PORT $LANGGRAPH_TUNNEL"
else
  echo "neither 'uv' nor .venv/bin/langgraph is available for storyboard-agent" >&2
  exit 1
fi
launch "langgraph" "$AGENT_DIR" "$LANGGRAPH_PORT" "$LG_CMD"

# --- optional convex dev ---------------------------------------------------
if [[ "$INCLUDE_CONVEX" -eq 1 ]]; then
  FRONTEND_DIR="$REPO_ROOT/dreamweaver-frontend"
  launch "convex" "$FRONTEND_DIR" "0" "bun run convex:dev"
fi

# --- frontend (next dev via bun) -------------------------------------------
FRONTEND_DIR="$REPO_ROOT/dreamweaver-frontend"
NEXT_LOCK="$FRONTEND_DIR/.next/dev/lock"
if [[ -f "$NEXT_LOCK" ]]; then
  echo "Next.js dev lock exists at $NEXT_LOCK — stop the existing frontend or remove the stale lock" >&2
  exit 1
fi
assert_port_free "$FRONTEND_PORT" "frontend"
launch "frontend" "$FRONTEND_DIR" "$FRONTEND_PORT" "bunx next dev --port $FRONTEND_PORT"

# --- persist pid metadata --------------------------------------------------
{
  printf '[\n'
  for i in "${!SVC_NAMES[@]}"; do
    sep=","
    [[ "$i" -eq $((${#SVC_NAMES[@]} - 1)) ]] && sep=""
    # Escape double-quotes in command for JSON.
    esc_cmd="$(printf '%s' "${SVC_CMDS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    esc_cwd="$(printf '%s' "${SVC_CWDS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    esc_out="$(printf '%s' "${SVC_OUTS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    esc_err="$(printf '%s' "${SVC_ERRS[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    printf '  {"name":"%s","pid":%s,"port":%s,"cwd":"%s","command":"%s","stdout":"%s","stderr":"%s"}%s\n' \
      "${SVC_NAMES[$i]}" "${SVC_PIDS[$i]}" "${SVC_PORTS[$i]}" \
      "$esc_cwd" "$esc_cmd" "$esc_out" "$esc_err" "$sep"
  done
  printf ']\n'
} >"$PID_FILE"

echo ""
echo "Started local storyboard stack:"
for i in "${!SVC_NAMES[@]}"; do
  echo " - ${SVC_NAMES[$i]}: pid=${SVC_PIDS[$i]}"
  echo "   out: ${SVC_OUTS[$i]}"
  echo "   err: ${SVC_ERRS[$i]}"
done
echo ""
echo "Endpoints:"
[[ "$SKIP_BACKEND" -eq 0 ]] && echo " - FastAPI backend:  http://127.0.0.1:$BACKEND_PORT"
echo " - LangGraph dev:    http://127.0.0.1:$LANGGRAPH_PORT"
echo " - Next.js frontend: http://127.0.0.1:$FRONTEND_PORT"
echo ""
echo "PID metadata: $PID_FILE"
echo "Tail logs with:  tail -f ${LOGS_DIR}/*-${TIMESTAMP}.out.log"
echo "Stop stack with: ./scripts/stop_storyboard_local.sh"
