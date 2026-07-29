#!/usr/bin/env bash
# Production stack: PgBouncer + N API replicas + built frontend/nginx.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPLICAS="${API_REPLICAS:-4}"
WITH_CF="${WITH_CLOUDFLARE:-0}"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

if [[ "${1:-}" == "--cloudflare" ]] || [[ "$WITH_CF" == "1" ]]; then
  COMPOSE+=(--profile cloudflare)
  if [[ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
    echo "Set CLOUDFLARE_TUNNEL_TOKEN in .env (see docs/PRODUCTION.md)." >&2
    exit 1
  fi
fi

echo "Starting production stack with api replicas=$REPLICAS ..."
"${COMPOSE[@]}" up -d --build --scale "api=${REPLICAS}" "${@:+$@}"

echo "Web: http://localhost:8080 (or your Cloudflare hostname)"
echo "Health: curl -s http://localhost:8080/api/health"
