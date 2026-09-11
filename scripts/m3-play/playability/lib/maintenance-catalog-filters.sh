#!/usr/bin/env bash
# Resolve the catalog-filters profile for playability maintenance without
# importing every operator variable from voice.env.
# shellcheck shell=bash

maintenance_operator_catalog_filters_from_voice_env() {
  local voice_env="${MANGO_VOICE_ENV:-${HOME}/.config/mango/voice.env}"
  [[ -f "$voice_env" ]] || return 0
  python3 - "$voice_env" "${HOME:-}" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
home = sys.argv[2]
try:
    stat = path.stat()
    if stat.st_size > 1024 * 1024:
        print("playability-maintenance: voice.env read_error: too_large", file=sys.stderr)
        raise SystemExit(2)
    lines = path.read_text(encoding="utf-8").splitlines()
except OSError:
    print("playability-maintenance: voice.env read_error", file=sys.stderr)
    raise SystemExit(2)

target_re = re.compile(r"^\s*(?:export\s+)?MANGO_CATALOG_FILTERS\s*=(.*)$")
parsed: str | None = None
expand_home = False

def unquote_literal(raw: str) -> tuple[str, bool]:
    value = raw.strip()
    if not value:
        return "", True
    if "`" in value or "$(" in value:
        raise ValueError("command substitution is not supported")
    if value[0] in {"'", '"'}:
        quote = value[0]
        end = value.find(quote, 1)
        if end < 0:
            raise ValueError("unterminated quoted value")
        if value[end + 1:].strip() not in {"", ";"}:
            raise ValueError("trailing tokens after quoted value")
        if quote == "'":
            return value[1:end], False
        # Decode ordinary shell-ish backslash escapes only inside double quotes;
        # no variable interpolation is allowed except the explicit HOME prefix below.
        body = value[1:end]
        decoded = []
        index = 0
        while index < len(body):
            char = body[index]
            if char == "\\" and index + 1 < len(body):
                nxt = body[index + 1]
                if nxt in {'"', "\\", "$", "`"}:
                    decoded.append(nxt)
                    index += 2
                    continue
            decoded.append(char)
            index += 1
        return "".join(decoded), True
    if re.search(r"\s", value):
        raise ValueError("unquoted value contains whitespace")
    if ";" in value or "|" in value or "&" in value or "<" in value or ">" in value:
        raise ValueError("unsupported shell syntax")
    return value, True

for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        continue
    match = target_re.match(line)
    if not match:
        continue
    try:
        parsed, expand_home = unquote_literal(match.group(1))
    except ValueError as exc:
        print(f"playability-maintenance: unsupported MANGO_CATALOG_FILTERS assignment in voice.env: {exc}", file=sys.stderr)
        raise SystemExit(2)

if parsed is None:
    raise SystemExit(0)
if expand_home and parsed.startswith("${HOME}/"):
    parsed = home + parsed[len("${HOME}"):]
elif expand_home and parsed.startswith("$HOME/"):
    parsed = home + parsed[len("$HOME"):]
elif expand_home and "$" in parsed:
    print("playability-maintenance: unsupported variable expansion in MANGO_CATALOG_FILTERS", file=sys.stderr)
    raise SystemExit(2)
print(parsed)
PY
}

maintenance_resolve_catalog_filters() {
  if [[ -n "${MANGO_CATALOG_FILTERS:-}" ]]; then
    printf '%s\n' "$MANGO_CATALOG_FILTERS"
    return 0
  fi

  local operator_filters
  operator_filters="$(maintenance_operator_catalog_filters_from_voice_env)" || return 1
  if [[ -n "$operator_filters" ]]; then
    printf '%s\n' "$operator_filters"
    return 0
  fi

  resolve_catalog_filters
}

maintenance_validate_catalog_filters() {
  local filters_json="$1"
  if [[ -z "$filters_json" || ! -r "$filters_json" ]]; then
    echo "playability-maintenance: catalog filters not readable: $filters_json" >&2
    return 1
  fi
  python3 - "$filters_json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception as exc:
    raise SystemExit(f"playability-maintenance: invalid catalog filters JSON: {path}: {exc}")
if not isinstance(data, dict):
    raise SystemExit(f"playability-maintenance: catalog filters must be a JSON object: {path}")
PY
}
