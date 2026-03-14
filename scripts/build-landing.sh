#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SRC_DIR="$ROOT_DIR/landing"
OUT_DIR="$SRC_DIR/dist"

BOT_USERNAME="${TELEGRAM_BOT_USERNAME:-}"

if [ -z "$BOT_USERNAME" ]; then
  if [ -f "$ROOT_DIR/backend/.env" ]; then
    BOT_USERNAME=$(grep -E '^TELEGRAM_BOT_USERNAME=' "$ROOT_DIR/backend/.env" | cut -d= -f2-)
  fi
fi

if [ -n "$BOT_USERNAME" ]; then
  BOT_URL="https://t.me/${BOT_USERNAME}"
else
  BOT_URL="#"
  echo "⚠  TELEGRAM_BOT_USERNAME not set — CTA links will point to #"
fi

mkdir -p "$OUT_DIR"

sed "s|{{BOT_URL}}|${BOT_URL}|g" "$SRC_DIR/index.html" > "$OUT_DIR/index.html"
cp "$SRC_DIR/styles.css" "$OUT_DIR/styles.css"

if [ "$BOT_URL" = "#" ]; then
  sed -i.bak 's|Подключить бесплатно|Скоро|g; s|Подключить</a>|Скоро</a>|g' "$OUT_DIR/index.html" && rm -f "$OUT_DIR/index.html.bak"
fi

echo "✓ Landing built → $OUT_DIR/"
echo "  BOT_URL = $BOT_URL"
