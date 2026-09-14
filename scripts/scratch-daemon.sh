#!/usr/bin/env bash
#
# VS-376: a scratch daemon for working on Weave AI inside Weave AI.
#
# The live daemon runs the same `packages/server/dist/bin.js` a scratch one does, so
# `pkill -f packages/server/dist/bin.js` (or `killall node`) kills the live one too. This helper
# starts a throwaway daemon against its own config dir and loopback port, records its pid, and stops
# only that pid — after checking its command line names this scratch config dir.
#
#   scripts/scratch-daemon.sh start  [--dir DIR] [--port PORT]
#   scripts/scratch-daemon.sh stop   [--dir DIR]
#   scripts/scratch-daemon.sh status [--dir DIR]
#
# DIR defaults to ${AC_SCRATCH_DIR:-${TMPDIR:-/tmp}/weave-scratch-daemon}. PORT defaults to 0, where
# the daemon picks a free port and writes it into <dir>/config/daemon.json.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/packages/server/dist/bin.js"
DIR="${AC_SCRATCH_DIR:-${TMPDIR:-/tmp}/weave-scratch-daemon}"
PORT="0"
CMD="${1:-}"
shift || true

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a value}"; shift 2 ;;
    --port) PORT="${2:?--port needs a value}"; shift 2 ;;
    *) echo "scratch-daemon: unknown option '$1'" >&2; exit 2 ;;
  esac
done

CONFIG_DIR="$DIR/config"
PID_FILE="$DIR/pid"
LOG_FILE="$DIR/daemon.log"

pid_running() {
  [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null
}

read_pid() {
  [ -f "$PID_FILE" ] && tr -d '[:space:]' < "$PID_FILE" || true
}

# A recorded pid is only ours if its command line names this scratch config dir. Anything else — a
# stale pid, a recycled pid, the live daemon — is refused rather than killed.
owns_pid() {
  local args
  args="$(ps -o args= -p "$1" 2>/dev/null || true)"
  [ -n "$args" ] && case "$args" in *"$CONFIG_DIR"*) return 0 ;; esac
  return 1
}

cmd_start() {
  local pid
  pid="$(read_pid)"
  if pid_running "$pid"; then
    echo "scratch daemon already running (pid $pid)"
    return 0
  fi
  if [ ! -f "$BIN" ]; then
    echo "scratch-daemon: no built server at $BIN — run 'pnpm build' first" >&2
    exit 1
  fi
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_DIR/daemon.yaml" <<'YAML'
auth:
  loopbackTrusted: true
YAML
  nohup node "$BIN" --config-dir "$CONFIG_DIR" --listen "127.0.0.1:$PORT" >"$LOG_FILE" 2>&1 &
  pid=$!
  echo "$pid" > "$PID_FILE"
  echo "scratch daemon started (pid $pid, config $CONFIG_DIR, log $LOG_FILE)"
}

cmd_stop() {
  local pid deadline
  pid="$(read_pid)"
  if [ -z "$pid" ] || ! pid_running "$pid"; then
    rm -f "$PID_FILE"
    echo "scratch daemon not running" >&2
    return 0
  fi
  if ! owns_pid "$pid"; then
    echo "scratch-daemon: refusing to stop pid $pid — its command line does not name $CONFIG_DIR" >&2
    echo "  (delete $PID_FILE if it is stale, or stop the pid you actually recorded)" >&2
    exit 1
  fi
  kill "$pid" 2>/dev/null || true
  deadline=$((SECONDS + 10))
  while pid_running "$pid" && [ "$SECONDS" -lt "$deadline" ]; do sleep 0.2; done
  if pid_running "$pid"; then kill -9 "$pid" 2>/dev/null || true; fi
  rm -f "$PID_FILE"
  echo "scratch daemon stopped (pid $pid)"
}

cmd_status() {
  local pid
  pid="$(read_pid)"
  if pid_running "$pid"; then
    echo "scratch daemon running (pid $pid)"
    return 0
  fi
  echo "scratch daemon not running"
  return 1
}

case "$CMD" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *)
    sed -n '2,16p' "${BASH_SOURCE[0]}" >&2
    exit 2
    ;;
esac
