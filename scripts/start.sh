#!/usr/bin/env sh
# Starts the local server and opens the app in your default browser (macOS / Linux).
cd "$(dirname "$0")/.." || exit 1
URL="http://localhost:${PORT:-5173}"
( sleep 1; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) &
exec node server.js
