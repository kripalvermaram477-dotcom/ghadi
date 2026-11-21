#!/data/data/com.termux/files/usr/bin/bash
# GHADI 24/7 watchdog: keeps server + Cloudflare tunnel alive
cd "$(dirname "$0")" || exit 1
LOG_DIR="$PREFIX/tmp"
mkdir -p "$LOG_DIR"

# keep CPU awake while charging
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null

while true; do
  if ! pgrep -f "node server.js" >/dev/null; then
    echo "[$(date)] server down, restarting..." >> "$LOG_DIR/ghadi-watchdog.log"
    nohup node server.js >> "$LOG_DIR/ghadi.log" 2>&1 &
    sleep 3
  fi
  if ! pgrep -f "cloudflared tunnel" >/dev/null; then
    echo "[$(date)] tunnel down, restarting..." >> "$LOG_DIR/ghadi-watchdog.log"
    nohup cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate >> "$LOG_DIR/cf.log" 2>&1 &
    sleep 8
  fi
  sleep 45
done
