#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SRC_DIR="$ROOT_DIR/landing"
OUT_DIR="$SRC_DIR/dist"

# Load env from backend/.env if present
if [ -f "$ROOT_DIR/backend/.env" ]; then
  set -a
  source "$ROOT_DIR/backend/.env"
  set +a
fi

mkdir -p "$OUT_DIR"

cp "$SRC_DIR/index.html" "$OUT_DIR/index.html"
cp "$SRC_DIR/styles.css" "$OUT_DIR/styles.css"

# Substitute METRIKA_COUNTER_ID or remove the Metrika block entirely
if [ -n "${METRIKA_COUNTER_ID:-}" ]; then
  sed -i.bak "s/{{METRIKA_COUNTER_ID}}/$METRIKA_COUNTER_ID/g" "$OUT_DIR/index.html"
  echo "  METRIKA_COUNTER_ID=$METRIKA_COUNTER_ID"
else
  sed -i.bak '/<!-- Yandex.Metrika -->/,/<!-- \/Yandex.Metrika -->/d' "$OUT_DIR/index.html"
  echo "  METRIKA_COUNTER_ID not set — Metrika block removed"
fi
rm -f "$OUT_DIR/index.html.bak"

if [ -d "$SRC_DIR/media" ]; then
  cp -r "$SRC_DIR/media" "$OUT_DIR/media"
  echo "  media/ copied"
fi

echo "✓ Landing built → $OUT_DIR/"
