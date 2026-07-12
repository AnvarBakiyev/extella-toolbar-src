#!/bin/bash
# Install the Extella local-server boot-restart LaunchAgent (macOS).
# Idempotent: safe to re-run. Removes with: ./install.sh --uninstall
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
BOOT="$HOME/extella-plugins/_boot"
LABEL="ai.extella.local-servers"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY="$(command -v python3 || echo /usr/bin/python3)"

if [ "$1" = "--uninstall" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Uninstalled $LABEL"
  exit 0
fi

mkdir -p "$BOOT"
cp "$HERE/restart_local_servers.py" "$BOOT/restart_local_servers.py"
sed -e "s#__PYTHON__#$PY#g" -e "s#__HOME__#$HOME#g" \
    "$HERE/ai.extella.local-servers.plist.template" > "$PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Installed $LABEL (runs at login + every 10 min)."
# Bring everything up right now too.
"$PY" "$BOOT/restart_local_servers.py"
