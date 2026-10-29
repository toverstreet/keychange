#!/bin/bash
#
# Builds KeyChange and assembles desktop/KeyChange.app around it.
# Re-run after editing launcher.sh, Info.plist, the icon, or the app itself.
#
# The repo path and the bin directories are baked into the launcher at build
# time rather than resolved from the bundle, so the .app works from
# /Applications or the Dock. Moving the PROJECT means re-running this; moving
# the APP does not.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
APP="$HERE/KeyChange.app"

command -v iconutil >/dev/null 2>&1 || {
    echo "iconutil not found -- Xcode command line tools are required." >&2
    exit 1
}

# Resolved here, from a shell with a real PATH, and baked into the launcher --
# which will not have one. An app launched from the Dock gets
# PATH=/usr/bin:/bin:/usr/sbin:/sbin, so node in /usr/local/bin and ffmpeg in
# /opt/homebrew/bin are both invisible to it.
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node is not on PATH. KeyChange cannot run without it." >&2; exit 1; }
NODE_BIN_DIR="$(cd "$(dirname "$NODE")" && pwd)"
echo "Using node from $NODE_BIN_DIR"

FFMPEG="$(command -v ffmpeg || true)"
[ -n "$FFMPEG" ] || {
    echo "ffmpeg is not on PATH. The worker decodes every file with it, so" >&2
    echo "analysis and stems would fail on launch. Install it: brew install ffmpeg" >&2
    exit 1
}
FFMPEG_BIN_DIR="$(cd "$(dirname "$FFMPEG")" && pwd)"
echo "Using ffmpeg from $FFMPEG_BIN_DIR"

# --- build the app ------------------------------------------------------
# `next build` and `next start`/`next dev` share one .next directory and
# corrupt each other in both directions, so anything serving it stops first.
LSOF=""
for candidate in /usr/sbin/lsof /usr/bin/lsof; do
    [ -x "$candidate" ] && { LSOF="$candidate"; break; }
done
if [ -n "$LSOF" ]; then
    for port in "${KEYCHANGE_PORT:-3210}" 3000; do
        pid="$("$LSOF" -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1)" || true
        if [ -n "${pid:-}" ]; then
            echo "Stopping the server on port $port before building (they share .next)."
            kill "$pid" 2>/dev/null || true
            sleep 1
        fi
    done
fi

echo "Building the web app..."
(cd "$REPO" && npm run build -w web)

# --- the icon -----------------------------------------------------------
if [ ! -f "$HERE/AppIcon.icns" ]; then
    echo "Generating the icon..."
    PY=""
    for candidate in "$REPO/services/worker/.venv/bin/python" python3 /usr/bin/python3; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import PIL" 2>/dev/null; then
            PY="$candidate"; break
        fi
    done
    [ -n "$PY" ] || { echo "No python3 with Pillow found; cannot generate the icon." >&2; exit 1; }
    "$PY" "$HERE/make_icon.py"
fi

# --- assemble -----------------------------------------------------------
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
cp "$HERE/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# Using | as the sed delimiter because every substitution is a path.
sed -e "s|__REPO_ROOT__|$REPO|g" \
    -e "s|__NODE_BIN_DIR__|$NODE_BIN_DIR|g" \
    -e "s|__FFMPEG_BIN_DIR__|$FFMPEG_BIN_DIR|g" \
    "$HERE/launcher.sh" > "$APP/Contents/MacOS/KeyChange"
chmod +x "$APP/Contents/MacOS/KeyChange"

# Ad-hoc signature. Not notarisation -- this app is not distributed, and a
# signed-by-nobody bundle is still what macOS wants before it will keep a
# stable identity across rebuilds rather than re-prompting for permissions.
codesign --force --deep --sign - "$APP" 2>/dev/null || \
    echo "note: ad-hoc codesign failed; the app still runs, macOS may prompt more often."

# Refresh Launch Services so the icon and name appear without a logout.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -f "$APP" >/dev/null 2>&1 || true

echo
echo "Built $APP"
echo
echo "  Open it:        open '$APP'"
echo "  Keep it handy:  drag it to your Dock, or"
echo "                  ln -sfn '$APP' /Applications/KeyChange.app"
echo
echo "  Stop servers:   desktop/stop.sh"
echo "  Logs:           ~/Library/Logs/KeyChange/"
