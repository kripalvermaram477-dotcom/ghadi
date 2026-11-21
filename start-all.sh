#!/data/data/com.termux/files/usr/bin/bash
# Start GHADI server + Cloudflare quick tunnel (free local hosting)
cd "$(dirname "$0")" || exit 1
LOG_DIR="$PREFIX/tmp"
mkdir -p "$LOG_DIR"

# start server if not running
if ! pgrep -f "node server.js" >/dev/null; then
  nohup node server.js > "$LOG_DIR/ghadi.log" 2>&1 &
  echo "GHADI server started on :3000"
else
  echo "GHADI server already running"
fi

# start cloudflared quick tunnel if not running
if ! pgrep -f "cloudflared tunnel" >/dev/null; then
  nohup cloudflared tunnel --url http://127.0.0.1:3000 --no-autoupdate > "$LOG_DIR/cf.log" 2>&1 &
  echo "Cloudflare tunnel starting..."
  sleep 8
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cf.log" | head -1)
  echo "Public URL: $URL"
else
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/cf.log" | head -1)
  echo "Tunnel already running: $URL"
fi
echo "Admin URL: ${URL}/admin"
