#!/bin/bash
#
# Builds the zip to send to another Mac.
#
# Ships source, not a built app: the launcher has absolute paths compiled into
# it and a Python environment with torch in it cannot be relocated. The
# recipient runs install.sh, which builds against their own machine -- and
# produces a locally-built bundle, which macOS does not quarantine the way it
# would a downloaded .app.
#
# Everything heavy is excluded and rebuilt there, so the zip is a couple of
# megabytes rather than a couple of gigabytes.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Usage: make_release.sh [output-dir] [version]
# Defaults to a dated build; pass a version to name a release asset, so the
# file a user downloads matches the tag they downloaded it from.
OUT="${1:-$HOME/Desktop}"
VERSION="${2:-$(date '+%Y%m%d')}"
NAME="KeyChange-${VERSION}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cd "$HERE"

# git archive rather than a copy with excludes: it ships exactly what is
# tracked, so a stray 90 MB stem left in .cache or a local .env cannot ride
# along by accident.
git archive --format=tar HEAD | (mkdir -p "$STAGE/$NAME" && tar -x -C "$STAGE/$NAME")

# uv.lock is not tracked but pins the Python side, so the recipient resolves
# the same versions rather than whatever is current.
cp services/worker/uv.lock "$STAGE/$NAME/services/worker/uv.lock"

# Sanity: the three things the recipient runs must be present and executable.
for required in install.sh "Install KeyChange.command" desktop/build_app.sh desktop/stop.sh INSTALL.md; do
    [ -f "$STAGE/$NAME/$required" ] || { echo "missing from the archive: $required" >&2; exit 1; }
done
chmod +x "$STAGE/$NAME/install.sh" "$STAGE/$NAME/Install KeyChange.command" \
         "$STAGE/$NAME/desktop/build_app.sh" "$STAGE/$NAME/desktop/stop.sh"

ZIP="$OUT/${NAME}.zip"
rm -f "$ZIP"
(cd "$STAGE" && zip -qr "$ZIP" "$NAME" -x '*.DS_Store')

echo "Built $ZIP"
echo "  $(du -h "$ZIP" | awk '{print $1}')  —  unzip, then run ./install.sh inside it"
