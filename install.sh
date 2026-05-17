#!/bin/bash
# Install the pomodoro server as a systemd user service and load the
# Chromium new-tab extension instructions.
set -e

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_NAME=pomodoro-server.service
UNIT_DIR="$HOME/.config/systemd/user"

mkdir -p "$UNIT_DIR"
ln -sfn "$REPO/$UNIT_NAME" "$UNIT_DIR/$UNIT_NAME"
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"

echo
echo "Server installed and running."
systemctl --user --no-pager status "$UNIT_NAME" | head -5
echo
echo "To load the Chromium extension:"
echo "  1. Open chromium and navigate to chrome://extensions/"
echo "  2. Enable Developer mode (top-right toggle)"
echo "  3. Click 'Load unpacked' and select: $REPO/extension"
echo
echo "Open a new tab to verify. The extension fetches http://127.0.0.1:17234/status."
