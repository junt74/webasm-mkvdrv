#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="$ROOT_DIR/target/wasm32-unknown-unknown/debug"
OUTPUT_DIR="$ROOT_DIR/web/public/wasm"

cargo build \
  -p mkvdrv-wasm-core \
  --target wasm32-unknown-unknown \
  --manifest-path "$ROOT_DIR/Cargo.toml"

mkdir -p "$OUTPUT_DIR"
cp "$TARGET_DIR/mkvdrv_wasm_core.wasm" "$OUTPUT_DIR/mkvdrv_wasm_core.wasm"
