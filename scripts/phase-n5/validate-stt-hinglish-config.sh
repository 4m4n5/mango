#!/usr/bin/env bash
# Gate: Pi STT config tuned for Hinglish couch voice (Deepgram nova-3 multi).
# Run on Pi or via pi-exec.sh.

set -euo pipefail

REPO_DIR="${MANGO_REPO_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_DIR"

python3 <<'PY'
import sys
import yaml
from pathlib import Path

path = Path("/etc/mango/config.yaml")
if not path.is_file():
    raise SystemExit("FAIL: /etc/mango/config.yaml missing")

raw = yaml.safe_load(path.read_text()) or {}
stt = raw.get("stt") or {}
model = str(stt.get("model", ""))
language = str(stt.get("language", ""))
strategy = str(stt.get("strategy", ""))

if "nova-3" not in model:
    raise SystemExit(f"FAIL: stt.model should include nova-3 (got {model!r})")
if language != "multi":
    raise SystemExit(f"FAIL: stt.language must be multi for Hinglish (got {language!r})")
if strategy not in {"multilingual", "multilingual_with_detect_fallback", "detect"}:
    raise SystemExit(f"FAIL: unknown stt.strategy {strategy!r}")

detect = stt.get("detect_languages") or []
if strategy != "multilingual" and "hi" not in detect:
    raise SystemExit("FAIL: stt.detect_languages should include hi for fallback")

print(f"PASS: hinglish STT config model={model} language={language} strategy={strategy}")
PY
