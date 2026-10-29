#!/bin/bash
#
# The executable inside KeyChange.app. Starts the two servers KeyChange needs
# if they are not already up, then opens a window onto the app.
#
# KeyChange is two processes, not one: a Next.js front end that owns all the
# interactive audio, and a Python worker that owns analysis and Demucs. The
# app is usable without the worker -- load, play, pitch, speed, loop and
# export all work -- so the worker is started but never blocks the window.
# Only the web server is waited on.
#
# Runs the PRODUCTION build, not `next dev`. Dev rebuilds on every file
# change, holds a watcher open, and is markedly slower to first paint; a
# desktop app should start once and stay put.
#
# __REPO_ROOT__ and the two bin directories are substituted by build_app.sh.
# Nothing resolves paths relative to the bundle, so the .app can be moved to
# /Applications or the Dock without breaking. Moving the PROJECT means
# re-running build_app.sh; moving the APP does not.

set -uo pipefail

REPO="__REPO_ROOT__"

# Substituted at build time from a real shell, because this one has none.
# macOS gives an app launched from the Dock PATH=/usr/bin:/bin:/usr/sbin:/sbin
# and nothing else -- no /usr/local/bin, no /opt/homebrew/bin. node lives in
# /usr/local/bin on this machine and ffmpeg in /opt/homebrew/bin, so without
# this the web server never starts and every analysis fails at the decode.
NODE_BIN_DIR="__NODE_BIN_DIR__"
FFMPEG_BIN_DIR="__FFMPEG_BIN_DIR__"
for candidate in "$NODE_BIN_DIR" "$FFMPEG_BIN_DIR" /opt/homebrew/bin /usr/local/bin /opt/local/bin; do
    case ":$PATH:" in
        *":$candidate:"*) ;;
        *) [ -d "$candidate" ] && PATH="$candidate:$PATH" ;;
    esac
done
export PATH

# lsof is in /usr/sbin on macOS, not /usr/bin. Resolved once; the call sites
# degrade honestly when it is absent rather than reading "command not found"
# as "nothing is listening".
LSOF=""
for candidate in /usr/sbin/lsof /usr/bin/lsof /opt/homebrew/bin/lsof /usr/local/bin/lsof; do
    [ -x "$candidate" ] && { LSOF="$candidate"; break; }
done

# 3210 rather than 3000 so the app and a `npm run dev` session can coexist.
# Hitting the dev server by accident from the app would be confusing in
# exactly the way that wastes an afternoon.
PORT="${KEYCHANGE_PORT:-3210}"
WORKER_PORT="${KEYCHANGE_WORKER_PORT:-8008}"
URL="http://127.0.0.1:${PORT}"
WORKER_URL="http://127.0.0.1:${WORKER_PORT}"

LOG_DIR="${HOME}/Library/Logs/KeyChange"
WEB_LOG="${LOG_DIR}/web.log"
WORKER_LOG="${LOG_DIR}/worker.log"
mkdir -p "$LOG_DIR"

die() {
    # A GUI app that fails silently is indistinguishable from one that did
    # nothing, so every exit path that is not success says so in a dialog.
    local message="$1"
    /usr/bin/osascript -e "display dialog \"${message//\"/\\\"}\" with title \"KeyChange\" buttons {\"OK\"} default button \"OK\" with icon caution" >/dev/null 2>&1
    exit 1
}

note() {
    /usr/bin/osascript -e "display notification \"$1\" with title \"KeyChange\"" >/dev/null 2>&1
}

listening_pid() {
    local port="$1"
    [ -n "$LSOF" ] || return 0
    "$LSOF" -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | /usr/bin/head -n 1
}

[ -d "$REPO" ] || die "The project folder is missing:

$REPO

The app was built pointing at that path. If the project moved, re-run desktop/build_app.sh from its new location."

command -v node >/dev/null 2>&1 || die "node is not installed, or is not where this app was told to look.

Rebuild the app with desktop/build_app.sh so it picks up the location."

# --- the web server -----------------------------------------------------

WEB_DIR="$REPO/apps/web"
[ -d "$WEB_DIR/.next" ] || die "KeyChange has not been built.

Run desktop/build_app.sh, which builds the app and then assembles the bundle."

# Is the build older than the code? Unlike a dev server nothing picks changes
# up, and the symptom is an app that silently runs last week's code.
build_is_stale() {
    local newer
    newer="$(/usr/bin/find "$WEB_DIR/app" "$WEB_DIR/components" "$WEB_DIR/lib" "$REPO/packages" \
             \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) \
             -newer "$WEB_DIR/.next/BUILD_ID" -print -quit 2>/dev/null)"
    [ -n "$newer" ]
}

if [ -f "$WEB_DIR/.next/BUILD_ID" ] && build_is_stale; then
    CHOICE=$(/usr/bin/osascript -e 'display dialog "KeyChange has been edited since it was last built.\n\nThe app runs the built copy, so those changes are not in it yet." with title "KeyChange" buttons {"Open anyway", "Rebuild"} default button "Rebuild" with icon note' -e 'button returned of result' 2>/dev/null)
    if [ "$CHOICE" = "Rebuild" ]; then
        note "Rebuilding — this takes a few seconds."
        # Stop a running server first: `next build` and `next start` share the
        # .next directory, and building underneath a running server corrupts
        # it in both directions.
        pid="$(listening_pid "$PORT")"
        [ -n "$pid" ] && { kill "$pid" 2>/dev/null; sleep 1; }
        if ! (cd "$REPO" && npm run build -w web >> "$WEB_LOG" 2>&1); then
            TAIL=$(/usr/bin/tail -n 12 "$WEB_LOG" 2>/dev/null | /usr/bin/sed 's/"/\\"/g')
            die "The rebuild failed.

Last lines of ${WEB_LOG}:

${TAIL}"
        fi
        note "Rebuilt."
    fi
fi

if ! /usr/bin/curl -sfo /dev/null --max-time 2 "$URL"; then
    if [ -n "$LSOF" ] && "$LSOF" -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
        die "Something is already listening on port ${PORT}, but it is not KeyChange.

Quit whatever is using that port, or set KEYCHANGE_PORT to a free one."
    fi

    { echo ""; echo "=== $(date '+%Y-%m-%d %H:%M:%S') web starting on port ${PORT} ==="; } >> "$WEB_LOG"

    cd "$WEB_DIR" || die "Could not enter $WEB_DIR"
    nohup npx next start -p "$PORT" >> "$WEB_LOG" 2>&1 &
    WEB_PID=$!
    echo "$WEB_PID" > "${LOG_DIR}/web.pid"

    READY=0
    for _ in $(seq 1 60); do
        if /usr/bin/curl -sfo /dev/null --max-time 2 "$URL"; then READY=1; break; fi
        if ! kill -0 "$WEB_PID" 2>/dev/null; then break; fi
        sleep 0.5
    done

    if [ "$READY" -ne 1 ]; then
        TAIL=$(/usr/bin/tail -n 12 "$WEB_LOG" 2>/dev/null | /usr/bin/sed 's/"/\\"/g')
        die "The KeyChange window did not start.

Last lines of ${WEB_LOG}:

${TAIL}"
    fi
fi

# --- the worker ---------------------------------------------------------
# Started but never waited on. Analysis and stem separation need it; loading,
# playback, pitch, speed, looping and export do not, and the app says so in
# its own UI when the worker is absent. Blocking the window on a process that
# imports librosa and torch would add seconds to every launch for a feature
# the user may not touch.

WORKER_DIR="$REPO/services/worker"
if ! /usr/bin/curl -sfo /dev/null --max-time 2 "${WORKER_URL}/health"; then
    if [ -x "$WORKER_DIR/.venv/bin/uvicorn" ] && ! { [ -n "$LSOF" ] && "$LSOF" -nP -iTCP:"$WORKER_PORT" -sTCP:LISTEN >/dev/null 2>&1; }; then
        { echo ""; echo "=== $(date '+%Y-%m-%d %H:%M:%S') worker starting on port ${WORKER_PORT} ==="; } >> "$WORKER_LOG"
        cd "$WORKER_DIR" && nohup "$WORKER_DIR/.venv/bin/uvicorn" keychange_worker.main:app \
            --host 127.0.0.1 --port "$WORKER_PORT" >> "$WORKER_LOG" 2>&1 &
        echo "$!" > "${LOG_DIR}/worker.pid"
    fi
fi

# --- the window ---------------------------------------------------------
# An app-mode window has no address bar or tabs, which is the difference
# between "an app" and "a browser pointed at localhost". Falls back to the
# default browser when no Chromium-family browser is installed.
open_app_window() {
    local browser
    for browser in \
        "/Applications/Google Chrome.app" \
        "/Applications/Microsoft Edge.app" \
        "/Applications/Brave Browser.app" \
        "/Applications/Chromium.app"
    do
        if [ -d "$browser" ]; then
            /usr/bin/open -na "$browser" --args --app="$URL" \
                --user-data-dir="${HOME}/Library/Application Support/KeyChange/window"
            return 0
        fi
    done
    return 1
}

open_app_window || /usr/bin/open "$URL"

# Nothing to wait for: both servers are detached and the window is another
# process. Quitting this launcher must not kill them, or closing the window
# during a stem separation would abandon a Demucs run several minutes in.
exit 0
