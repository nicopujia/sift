#!/usr/bin/env bash
# chrome.sh start|reload|stop: the test Chrome (tmux window sift:chrome, port 9444).
# start and reload end by checking that the extension's service worker runs the
# current dist/background.js (`bun scripts/lib.ts worker <id>` prints its
# PROMPT_VERSION and a hash). Chrome started on an existing profile keeps the old
# worker script while the content scripts are new (F923), so start reinstalls
# when they differ (that wipes Sift's IndexedDB cache). Both exit 1, loudly, if
# the worker still differs from dist.
set -euo pipefail
cd "$(dirname "$0")/.."
cmd=${1:-start}
# A non-default SIFT_OUT gets its own pid file, log, and profile.
sfx="${SIFT_OUT:+-$SIFT_OUT}"
# So does a non-default port: `SIFT_PORT=9445 ... stop` once killed the 9444 Chrome of the same tree.
[ "${SIFT_PORT:-9444}" = 9444 ] || sfx="$sfx-$SIFT_PORT"
log=.chrome/launch${sfx}.log
pid() { local p; p=$(cat .chrome/launch${sfx}.pid 2>/dev/null || true); [ -n "$p" ] && kill -0 "$p" 2>/dev/null && echo "$p" || true; }
check() { bun scripts/lib.ts worker "$(grep -oE '(extension|reinstalled) [a-p]{32}' "$log" | tail -1 | cut -d' ' -f2)"; }
reinstall() {
  local n; n=$(grep -c reinstalled "$log" || true)
  kill -USR1 "$1"
  for i in $(seq 1 40); do [ "$(grep -c reinstalled "$log" || true)" -gt "$n" ] && { tail -1 "$log"; return 0; }; sleep 0.25; done
  echo "reload timed out"; tail -5 "$log"; return 1
}
stale() { echo "ERROR: the service worker still runs old code, not dist/background.js. Stop and start again." >&2; exit 1; }
case "$cmd" in
  start)
    if [ -n "$(pid)" ]; then
      echo "already running"
    else
      tmux has-session -t sift 2>/dev/null || tmux new-session -d -s sift -n shell -c "$PWD"
      win="chrome${SIFT_PORT:-}"
      tmux kill-window -t "sift:$win" 2>/dev/null || true
      mkdir -p .chrome
      # The old log still says "chrome up"; drop it so the wait below sees this launch.
      rm -f "$log"
      tmux new-window -d -t sift -n "$win" -c "$PWD" "SIFT_PORT=${SIFT_PORT:-9444} SIFT_OUT=${SIFT_OUT:-dist} SIFT_BLOCK_EXTRA='${SIFT_BLOCK_EXTRA:-}' bun scripts/launch.ts 2>&1 | tee $log"
      up=
      for i in $(seq 1 60); do grep -q "chrome up" "$log" 2>/dev/null && { tail -1 "$log"; up=1; break; }; sleep 0.25; done
      [ -n "$up" ] || { echo "did not start"; tail -20 "$log"; exit 1; }
    fi
    check || { echo "reinstalling the extension so the worker runs dist"; reinstall "$(pid)" && check || stale; } ;;
  reload)
    p=$(pid); [ -z "$p" ] && { "$0" start; exit; }
    reinstall "$p"
    check || stale ;;
  stop)
    p=$(pid); [ -n "$p" ] && kill "$p"; tmux kill-window -t "sift:chrome${SIFT_PORT:-}" 2>/dev/null || true; echo stopped ;;
esac
