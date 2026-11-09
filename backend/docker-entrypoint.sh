#!/bin/sh
set -e

echo "[entrypoint] running database migrations"
alembic upgrade head

echo "[entrypoint] seeding users (skipped if SEED_* vars are not set)"
python -m app.seed

echo "[entrypoint] starting API on port ${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers --forwarded-allow-ips="*"
