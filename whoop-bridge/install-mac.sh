#!/bin/bash
# Installs the WHOOP bridge for Training Plenum as a LaunchAgent on macOS.
#   bash whoop-bridge/install-mac.sh             install or update
#   bash whoop-bridge/install-mac.sh --uninstall stop and remove the LaunchAgent (keeps ~/.trainingplenum-whoop)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DATA="$HOME/.trainingplenum-whoop"
APP="$DATA/app"
VENV="$DATA/venv"
LABEL="com.trainingplenum.whoop-bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Bridge gestoppt und LaunchAgent entfernt. Daten und Puffer bleiben in $DATA."
  exit 0
fi

if [ "$(uname)" != "Darwin" ]; then
  echo "Dieses Skript ist für macOS. Unter Linux: python3 bridge.py run" >&2
  exit 1
fi

PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  for candidate in python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
      PYTHON="$(command -v "$candidate")"
      break
    fi
  done
fi
if [ -z "$PYTHON" ]; then
  echo "Python 3.11 oder neuer fehlt. Installieren mit: brew install python@3.12 (oder von python.org)" >&2
  exit 1
fi

mkdir -p "$APP" "$HOME/Library/LaunchAgents"
chmod 700 "$DATA"
cp "$HERE/bridge.py" "$HERE/../backend/whoop_protocol.py" "$APP/"
if [ ! -x "$VENV/bin/python" ]; then
  "$PYTHON" -m venv "$VENV"
fi
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$HERE/requirements.txt"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$VENV/bin/python</string>
    <string>$APP/bridge.py</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$DATA/bridge.log</string>
  <key>StandardErrorPath</key><string>$DATA/bridge.log</string>
</dict>
</plist>
PLIST

echo "✓ Bridge installiert in $APP"
if [ -f "$DATA/config.json" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  echo "✓ Hintergrunddienst neu gestartet. Log: $DATA/bridge.log"
else
  echo "Nächster Schritt: den setup-Befehl aus Training Plēnum (Profil → WHOOP-Strap verbinden) im Terminal ausführen:"
  echo "  $VENV/bin/python $APP/bridge.py setup <URL> <TOKEN>"
fi
