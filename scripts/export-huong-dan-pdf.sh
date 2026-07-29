#!/usr/bin/env bash
# Build HUONG_DAN_SU_DUNG.pdf from HUONG_DAN_SU_DUNG.md (requires Docker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

docker run --rm -v "$ROOT:/work" -w /work node:20-bookworm-slim bash -c '
  apt-get update -qq && apt-get install -y -qq chromium fonts-noto-core fonts-liberation > /dev/null
  npm install -g md-to-pdf@5.2.4 2>/dev/null
  export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
  md-to-pdf HUONG_DAN_SU_DUNG.md --config-file scripts/md-to-pdf.config.cjs
'

echo "Wrote $ROOT/HUONG_DAN_SU_DUNG.pdf"
