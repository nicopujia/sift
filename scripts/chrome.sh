#!/usr/bin/env bash
# chrome.sh start|reload|stop: the test Chrome (tmux window sift:chrome, port 9444).
set -euo pipefail
cd "$(dirname "$0")/.."
cmd=${1:-start}
# A non-default SIFT_OUT gets its own pid file, log, and profile.
sfx="${SIFT_OUT:+-$SIFT_OUT}"
pid() { local p; p=$(cat .chrome/launch${sfx}.pid 2>/dev/null || true); [ -n "$p" ] && kill -0 "$p" 2>/dev/null && echo "$p" || true; }
case "$cmd" in
  start)
    if [ -n "$(pid)" ]; then echo "already running"; exit 0; fi
    tmux has-session -t sift 2>/dev/null || tmux new-session -d -s sift -n shell -c "$PWD"
    win="chrome${SIFT_PORT:-}"
    tmux kill-window -t "sift:$win" 2>/dev/null || true
    mkdir -p .chrome
    tmux new-window -d -t sift -n "$win" -c "$PWD" "SIFT_PORT=${SIFT_PORT:-9444} SIFT_OUT=${SIFT_OUT:-dist} bun scripts/launch.ts 2>&1 | tee .chrome/launch${sfx}.log"
    for i in $(seq 1 60); do grep -q "chrome up" .chrome/launch${sfx}.log 2>/dev/null && { tail -1 .chrome/launch${sfx}.log; exit 0; }; sleep 0.25; done
    echo "did not start"; tail -20 .chrome/launch${sfx}.log; exit 1 ;;
  reload)
    p=$(pid); [ -z "$p" ] && { "$0" start; exit; }
    n=$(grep -c reinstalled .chrome/launch${sfx}.log || true)
    kill -USR1 "$p"
    for i in $(seq 1 40); do [ "$(grep -c reinstalled .chrome/launch${sfx}.log || true)" -gt "$n" ] && { tail -1 .chrome/launch${sfx}.log; exit 0; }; sleep 0.25; done
    echo "reload timed out"; tail -5 .chrome/launch${sfx}.log; exit 1 ;;
  stop)
    p=$(pid); [ -n "$p" ] && kill "$p"; tmux kill-window -t "sift:chrome${SIFT_PORT:-}" 2>/dev/null || true; echo stopped ;;
esac
