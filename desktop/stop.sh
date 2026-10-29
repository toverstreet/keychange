#!/bin/bash
#
# Stops the servers KeyChange.app leaves running.
#
# The launcher deliberately detaches them, so closing the window does not
# abandon a separation that is minutes into a Demucs run. The cost of that
# choice is that they outlive the window -- and the worker holds torch
# resident, which is worth reclaiming when you are done for the day.

set -uo pipefail

PORT="${KEYCHANGE_PORT:-3210}"
WORKER_PORT="${KEYCHANGE_WORKER_PORT:-8008}"

LSOF=""
for candidate in /usr/sbin/lsof /usr/bin/lsof /opt/homebrew/bin/lsof /usr/local/bin/lsof; do
    [ -x "$candidate" ] && { LSOF="$candidate"; break; }
done
[ -n "$LSOF" ] || { echo "lsof not found; cannot find the servers." >&2; exit 1; }

for entry in "KeyChange:$PORT" "worker:$WORKER_PORT"; do
    name="${entry%%:*}"
    port="${entry##*:}"
    pid="$("$LSOF" -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1)"
    if [ -n "$pid" ]; then
        kill "$pid" 2>/dev/null && echo "stopped $name (pid $pid, port $port)"
    else
        echo "$name was not running on port $port"
    fi
done
