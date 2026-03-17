#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

SRC_DIR="$ROOT_DIR/landing"
OUT_DIR="$SRC_DIR/dist"

mkdir -p "$OUT_DIR"

cp "$SRC_DIR/index.html" "$OUT_DIR/index.html"
cp "$SRC_DIR/styles.css" "$OUT_DIR/styles.css"

if [ -d "$SRC_DIR/media" ]; then
  cp -r "$SRC_DIR/media" "$OUT_DIR/media"
  echo "  media/ copied"
fi

echo "✓ Landing built → $OUT_DIR/"
