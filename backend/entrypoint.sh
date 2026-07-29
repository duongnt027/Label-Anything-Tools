#!/bin/sh
set -e
WORKERS="${WEB_CONCURRENCY:-4}"
TIMEOUT="${GUNICORN_TIMEOUT:-120}"
exec gunicorn app.main:app \
  -k uvicorn.workers.UvicornWorker \
  -b "0.0.0.0:8000" \
  --workers "$WORKERS" \
  --timeout "$TIMEOUT" \
  --graceful-timeout 30 \
  --keep-alive 5 \
  --access-logfile - \
  --error-logfile -
