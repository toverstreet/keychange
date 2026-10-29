#!/bin/bash
#
# Sets KeyChange up on a Mac and builds KeyChange.app.
#
# This is a source package, not a prebuilt app, for two reasons. The launcher
# has absolute paths compiled into it -- the project folder, and the
# directories node and ffmpeg live in -- which differ on every machine. And a
# Python environment with torch in it is not relocatable; moving one breaks it.
# Building here means the app matches this machine, and it also means the
# bundle is locally made rather than downloaded, so macOS does not quarantine
# it the way it would a .app pulled off the internet.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'

say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==>%s %s%s\n' "$GREEN" "$OFF" "$BOLD" "$*$OFF"; }
warn() { printf '%s!!%s %s\n' "$YELLOW" "$OFF" "$*"; }
fail() { printf '\n%sInstall stopped.%s %s\n\n' "$RED" "$OFF" "$*"; exit 1; }

say ""
say "${BOLD}KeyChange${OFF} — local audio studio"
say "${DIM}Analyse key and BPM, shift pitch and speed independently, loop to the beat,${OFF}"
say "${DIM}separate vocals, and export. Nothing is uploaded anywhere.${OFF}"

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS."

# --- what do they want installed ---------------------------------------
# Asked first, because it is the difference between a ~100 MB install and a
# ~1 GB one and nobody wants to discover that halfway through a download.
STEMS=""
if [ "${1:-}" = "--with-stems" ]; then STEMS=yes; fi
if [ "${1:-}" = "--no-stems" ];   then STEMS=no;  fi

if [ -z "$STEMS" ]; then
    say ""
    say "Stem separation (splitting a song into vocals and backing) is optional."
    say "  ${BOLD}with${OFF}    about 1 GB, downloads PyTorch, and needs a few minutes"
    say "  ${BOLD}without${OFF} about 100 MB — everything else still works:"
    say "          ${DIM}key and BPM, pitch, speed, looping, EQ, reverb, export${OFF}"
    say ""
    printf 'Install stem separation? [y/N] '
    read -r answer </dev/tty
    case "$answer" in [Yy]*) STEMS=yes ;; *) STEMS=no ;; esac
fi
say ""
say "Installing ${BOLD}$([ "$STEMS" = yes ] && echo "with" || echo "without")${OFF} stem separation."

# --- prerequisites ------------------------------------------------------
BREW="$(command -v brew || true)"
for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -n "$BREW" ] && break
    [ -x "$candidate" ] && BREW="$candidate"
done
[ -n "$BREW" ] && eval "$("$BREW" shellenv)" 2>/dev/null

missing=()
command -v node    >/dev/null 2>&1 || missing+=("node")
command -v ffmpeg  >/dev/null 2>&1 || missing+=("ffmpeg")
command -v uv      >/dev/null 2>&1 || missing+=("uv")

if [ ${#missing[@]} -gt 0 ]; then
    step "Installing what is missing: ${missing[*]}"
    if [ -z "$BREW" ]; then
        fail "These are needed and Homebrew is not installed to get them:

  ${missing[*]}

Install Homebrew first, from https://brew.sh, then run this again.
(Or install those three yourself by any means you prefer.)"
    fi
    for pkg in "${missing[@]}"; do
        say "  installing $pkg..."
        "$BREW" install "$pkg" >/dev/null 2>&1 || fail "Could not install $pkg with Homebrew. Try: brew install $pkg"
    done
    eval "$("$BREW" shellenv)" 2>/dev/null
fi

for tool in node ffmpeg uv; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool still is not on PATH after installing. Open a new Terminal and run this again."
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || fail "Node 20 or newer is required; this machine has $(node -v 2>/dev/null || echo none).
Update it with:  brew upgrade node"

say "  node    $(node -v)"
say "  ffmpeg  $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"
say "  uv      $(uv --version 2>/dev/null | awk '{print $2}')"

# --- the web app --------------------------------------------------------
step "Installing the app's JavaScript dependencies"
npm install --no-fund --no-audit || fail "npm install failed."

# --- the worker ---------------------------------------------------------
step "Setting up the analysis worker (Python)"
say "${DIM}This is the slow part$([ "$STEMS" = yes ] && echo " — PyTorch is a large download").${OFF}"
(
    cd services/worker || exit 1
    if [ "$STEMS" = yes ]; then
        uv sync --extra stems
    else
        uv sync
    fi
) || fail "Could not set up the Python environment."

# --- build the app ------------------------------------------------------
step "Building KeyChange.app"
./desktop/build_app.sh || fail "The build failed."

# --- install it ---------------------------------------------------------
APP="$HERE/desktop/KeyChange.app"
step "Finishing up"
# KEYCHANGE_NO_APPLICATIONS=1 keeps the app in this folder. Useful when trying
# a copy out without disturbing one already installed.
if [ -n "${KEYCHANGE_NO_APPLICATIONS:-}" ]; then
    say "  leaving the app in place (KEYCHANGE_NO_APPLICATIONS is set)"
    INSTALLED="$APP"
elif [ -w /Applications ]; then
    rm -rf "/Applications/KeyChange.app"
    # Copied rather than symlinked: a symlink into a Downloads folder breaks
    # the first time the folder is tidied up, and the app is small.
    cp -R "$APP" "/Applications/KeyChange.app" && say "  installed to /Applications/KeyChange.app"
    INSTALLED="/Applications/KeyChange.app"
else
    warn "/Applications is not writable; leaving the app where it was built."
    INSTALLED="$APP"
fi

say ""
say "${GREEN}${BOLD}Done.${OFF}"
say ""
say "  Open it:  ${BOLD}open '$INSTALLED'${OFF}"
say "            ${DIM}or find KeyChange in Launchpad, and drag it to your Dock${OFF}"
say ""
say "  ${BOLD}Keep this folder.${OFF} The app is a launcher — it runs the code that lives here,"
say "  so moving or deleting this folder stops it working. If you do move it,"
say "  run ./install.sh again from the new location."
say ""
if [ "$STEMS" = no ]; then
    say "  ${DIM}To add stem separation later: cd services/worker && uv sync --extra stems${OFF}"
    say ""
fi
say "  Stop the servers:  ./desktop/stop.sh"
say "  Logs:              ~/Library/Logs/KeyChange/"
say ""
