#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SRC_DIR="$ROOT_DIR/landing"
OUT_DIR="$SRC_DIR/dist"

ADMIN_URL_VAL="${ADMIN_URL:-}"

if [ -z "$ADMIN_URL_VAL" ]; then
  if [ -f "$ROOT_DIR/backend/.env" ]; then
    ADMIN_URL_VAL=$(grep -E '^ADMIN_URL=' "$ROOT_DIR/backend/.env" | cut -d= -f2- || true)
  fi
fi

if [ -z "$ADMIN_URL_VAL" ]; then
  ADMIN_URL_VAL="#"
  echo "⚠  ADMIN_URL not set — CTA links will point to #"
fi

mkdir -p "$OUT_DIR"

sed "s|{{ADMIN_URL}}|${ADMIN_URL_VAL}|g" "$SRC_DIR/index.html" > "$OUT_DIR/index.html"
cp "$SRC_DIR/styles.css" "$OUT_DIR/styles.css"

if [ -d "$SRC_DIR/media" ]; then
  cp -r "$SRC_DIR/media" "$OUT_DIR/media"
  echo "  media/ copied"
fi

if [ "$ADMIN_URL_VAL" = "#" ]; then
  sed -i.bak 's|Попробовать бесплатно|Скоро|g; s|Попробовать</a>|Скоро</a>|g' "$OUT_DIR/index.html" && rm -f "$OUT_DIR/index.html.bak"
fi

echo "✓ Landing built → $OUT_DIR/"
echo "  ADMIN_URL = $ADMIN_URL_VAL"
