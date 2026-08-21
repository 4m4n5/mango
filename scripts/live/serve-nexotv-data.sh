#!/usr/bin/env bash
# Serve the NexoTV data dir over localhost HTTP so NexoTV's M3U provider can
# ingest the curated AREA69 M3U (NexoTV only accepts HTTP(S) m3uUrl, not file://).
#
# Bound to 127.0.0.1:7010. The M3U (live-area69-curated.m3u) is written into the
# data dir by scripts/live/build-curated-area69-m3u.py with mode 0600; it contains
# credentials-embedded stream URLs and must never be committed or exposed off-host.

set -euo pipefail

DATA_DIR="${MANGO_NEXOTV_DATA_DIR:-$HOME/.local/share/mango/nexotv/data}"
PORT="${MANGO_NEXOTV_M3U_PORT:-7010}"

mkdir -p "$DATA_DIR"
exec python3 -m http.server "$PORT" \
  --bind 127.0.0.1 \
  --directory "$DATA_DIR"
