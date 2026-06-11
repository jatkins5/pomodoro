#!/bin/bash
# Install the pomodoro server as a systemd user service and load the
# Chromium new-tab extension instructions.
set -e

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_NAME=pomodoro-server.service
UNIT_DIR="$HOME/.config/systemd/user"

mkdir -p "$UNIT_DIR"
ln -sfn "$REPO/$UNIT_NAME" "$UNIT_DIR/$UNIT_NAME"
for unit in pomodoro-learning-nudge.service pomodoro-learning-nudge.timer \
            pomodoro-motd-build.service pomodoro-motd-build.timer; do
  ln -sfn "$REPO/$unit" "$UNIT_DIR/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT_NAME"
# Restart so an already-running server picks up code changes on reinstall.
systemctl --user restart "$UNIT_NAME"
systemctl --user enable --now pomodoro-learning-nudge.timer
# The MOTD build timer is installed but left disabled — it needs ANTHROPIC_API_KEY.
# Set the key (Environment= in pomodoro-motd-build.service, or an EnvironmentFile),
# then: systemctl --user enable --now pomodoro-motd-build.timer

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
echo
echo "Message of the day: add sources, then build (needs OPENROUTER_API_KEY):"
echo "  $REPO/pomodoro motd add https://example.com/post"
echo "  OPENROUTER_API_KEY=... $REPO/pomodoro motd build"
echo "Optionally enable the weekly rebuild once the key is set in the service:"
echo "  systemctl --user enable --now pomodoro-motd-build.timer"
