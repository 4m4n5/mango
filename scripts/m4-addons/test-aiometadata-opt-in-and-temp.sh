#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

export MANGO_REPO_DIR="$REPO_DIR"
export XDG_CACHE_HOME="$TMP_DIR/cache"
export MANGO_AIOMETADATA_CREDS="$TMP_DIR/aiometadata.credentials"
mkdir -p "$TMP_DIR/bin"

cat >"$TMP_DIR/bin/curl" <<'SH'
#!/usr/bin/env bash
out=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) shift 2 ;;
    *) shift ;;
  esac
done
if [[ "${MANGO_TEST_CURL_FAIL:-0}" == "1" ]]; then
  [[ -n "$out" ]] && printf '{"error":"secret-body-should-not-print","installUrl":"http://secret.invalid/manifest.json"}' >"$out"
  exit 7
fi
if [[ -n "$out" ]]; then
  if [[ "${MANGO_TEST_MALFORMED_JSON:-0}" == "1" ]]; then
    printf '{"userUUID":' >"$out"
  elif [[ "${MANGO_TEST_HTTP_CODE:-200}" != "200" ]]; then
    printf '{"error":"secret-body-should-not-print","installUrl":"http://secret.invalid/manifest.json"}' >"$out"
  else
    printf '{"userUUID":"uuid-test","installUrl":"http://secret.invalid/stremio/test/manifest.json"}' >"$out"
  fi
fi
printf '%s' "${MANGO_TEST_HTTP_CODE:-200}"
SH
chmod +x "$TMP_DIR/bin/curl"
export PATH="$TMP_DIR/bin:$PATH"

if MANGO_SYNC_AIOMETADATA=0 bash "$REPO_DIR/scripts/m4-addons/sync-aiometadata-rail-catalogs.sh" \
    >"$TMP_DIR/skip.out" 2>"$TMP_DIR/skip.err"; then
  grep -q 'MANGO_SYNC_AIOMETADATA=1' "$TMP_DIR/skip.out"
else
  cat "$TMP_DIR/skip.out" "$TMP_DIR/skip.err" >&2
  exit 1
fi

import_json="$TMP_DIR/import.json"
catalog_yaml="$TMP_DIR/catalog.yaml"
printf '{"config":{"catalogs":[],"apiKeys":{}}}\n' >"$import_json"
printf 'rails: []\n' >"$catalog_yaml"
password_value='pw test $dollar "quote" and '\''single'\'''

MANGO_CATALOG_YAML="$catalog_yaml" \
MANGO_AIOMETADATA_PASSWORD="$password_value" \
MANGO_AIOMETADATA_IMPORT_MODE="exact" \
MANGO_STREMIO_EXPORT="$TMP_DIR/stremio-export.json" \
  bash "$REPO_DIR/scripts/m4-addons/aiometadata-config.sh" import "$import_json" \
  >"$TMP_DIR/import.out"

grep -q 'saved ' "$TMP_DIR/import.out"
grep -q 'manifest saved' "$TMP_DIR/import.out"
if grep -Eq 'secret\.invalid|manifest:' "$TMP_DIR/import.out"; then
  echo "FAIL: import printed secret manifest material" >&2
  exit 1
fi
grep -q 'AIOMETADATA_UUID=uuid-test' "$MANGO_AIOMETADATA_CREDS"
original_creds="$(cat "$MANGO_AIOMETADATA_CREDS")"
python3 - "$MANGO_AIOMETADATA_CREDS" <<'PY'
import os
import stat
import sys
mode = stat.S_IMODE(os.stat(sys.argv[1]).st_mode)
if mode != 0o600:
    raise SystemExit(f"credentials mode is {mode:o}, expected 600")
PY
bash -c 'source "$1"; [[ "$AIOMETADATA_PASSWORD" == "$2" ]]' bash "$MANGO_AIOMETADATA_CREDS" "$password_value"

TMPDIR_ROOT="$TMP_DIR/private-tmp"
mkdir -p "$TMPDIR_ROOT"
set +e
TMPDIR="$TMPDIR_ROOT" \
MANGO_TEST_CURL_FAIL=1 \
MANGO_CATALOG_YAML="$catalog_yaml" \
MANGO_AIOMETADATA_PASSWORD="$password_value" \
MANGO_AIOMETADATA_IMPORT_MODE="exact" \
  bash "$REPO_DIR/scripts/m4-addons/aiometadata-config.sh" import "$import_json" \
  >"$TMP_DIR/fail.out" 2>"$TMP_DIR/fail.err"
FAIL_RC=$?
set -e
[[ "$FAIL_RC" -ne 0 ]]
if grep -Eq 'secret-body-should-not-print|secret\.invalid' "$TMP_DIR/fail.out" "$TMP_DIR/fail.err"; then
  echo "FAIL: failed save printed response body or manifest URL" >&2
  exit 1
fi
if [[ -n "$(find "$TMPDIR_ROOT" -mindepth 1 -print -quit)" ]]; then
  echo "FAIL: failed save leaked temp files" >&2
  find "$TMPDIR_ROOT" -mindepth 1 -maxdepth 2 >&2
  exit 1
fi
[[ "$(cat "$MANGO_AIOMETADATA_CREDS")" == "$original_creds" ]]
rm -rf "$TMPDIR_ROOT"
mkdir -p "$TMPDIR_ROOT"

set +e
TMPDIR="$TMPDIR_ROOT" \
MANGO_TEST_HTTP_CODE=500 \
MANGO_CATALOG_YAML="$catalog_yaml" \
MANGO_AIOMETADATA_PASSWORD="$password_value" \
MANGO_AIOMETADATA_IMPORT_MODE="exact" \
  bash "$REPO_DIR/scripts/m4-addons/aiometadata-config.sh" import "$import_json" \
  >"$TMP_DIR/non200.out" 2>"$TMP_DIR/non200.err"
NON200_RC=$?
set -e
[[ "$NON200_RC" -ne 0 ]]
if grep -Eq 'secret-body-should-not-print|secret\.invalid' "$TMP_DIR/non200.out" "$TMP_DIR/non200.err"; then
  echo "FAIL: HTTP non-200 printed response body or manifest URL" >&2
  exit 1
fi
[[ "$(cat "$MANGO_AIOMETADATA_CREDS")" == "$original_creds" ]]
if [[ -n "$(find "$TMPDIR_ROOT" -mindepth 1 -print -quit)" ]]; then
  echo "FAIL: HTTP non-200 leaked temp files" >&2
  find "$TMPDIR_ROOT" -mindepth 1 -maxdepth 2 >&2
  exit 1
fi
rm -rf "$TMPDIR_ROOT"
mkdir -p "$TMPDIR_ROOT"

set +e
TMPDIR="$TMPDIR_ROOT" \
MANGO_TEST_MALFORMED_JSON=1 \
MANGO_CATALOG_YAML="$catalog_yaml" \
MANGO_AIOMETADATA_PASSWORD="$password_value" \
MANGO_AIOMETADATA_IMPORT_MODE="exact" \
  bash "$REPO_DIR/scripts/m4-addons/aiometadata-config.sh" import "$import_json" \
  >"$TMP_DIR/malformed.out" 2>"$TMP_DIR/malformed.err"
MALFORMED_RC=$?
set -e
[[ "$MALFORMED_RC" -ne 0 ]]
[[ "$(cat "$MANGO_AIOMETADATA_CREDS")" == "$original_creds" ]]
if [[ -n "$(find "$TMPDIR_ROOT" -mindepth 1 -print -quit)" ]]; then
  echo "FAIL: malformed JSON leaked temp files" >&2
  find "$TMPDIR_ROOT" -mindepth 1 -maxdepth 2 >&2
  exit 1
fi

echo "PASS: AIOMetadata sync is opt-in and temp cleanup avoids RETURN-scope traps"
