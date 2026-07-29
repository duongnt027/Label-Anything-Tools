#!/usr/bin/env bash
# Public URL via Cloudflare Quick Tunnel (trycloudflare.com) — no dashboard account needed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Ensuring web stack is up..."
docker compose up -d web

echo "Starting Cloudflare Quick Tunnel..."
docker compose --profile quicktunnel up -d cloudflared-quick

echo "Waiting for public URL in logs (up to 90s)..."
for i in $(seq 1 45); do
  URL="$(docker compose logs cloudflared-quick 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
  if [[ -n "$URL" ]]; then
    echo ""
    echo "============================================"
    echo " Public URL (Quick Tunnel):"
    echo " $URL"
    echo "============================================"
    echo "URL đổi mỗi lần restart container. Xem lại: docker compose logs cloudflared-quick"
    exit 0
  fi
  sleep 2
done

echo "Chưa thấy URL trong log. Chạy: docker compose logs -f cloudflared-quick" >&2
exit 1
