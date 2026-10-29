#!/bin/bash
#
# Double-clickable installer for people who would rather not open Terminal.
#
# A .command file opens Terminal and runs itself, so this is the same
# install.sh beside it with two differences: it finds its own folder first,
# because a double-clicked script starts in the user's home directory and not
# where it lives; and it holds the window open at the end, because otherwise
# Terminal closes on the last line and any error disappears with it.

cd "$(dirname "$0")" || {
    echo "Could not find the KeyChange folder."
    echo "Press Return to close this window."
    read -r
    exit 1
}

./install.sh
STATUS=$?

echo
if [ "$STATUS" -ne 0 ]; then
    echo "The install did not finish. The messages above say why."
    echo
fi
echo "Press Return to close this window."
read -r
exit "$STATUS"
