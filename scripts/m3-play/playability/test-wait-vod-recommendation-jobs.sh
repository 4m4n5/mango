#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat >"$TMP/curl" <<'SH'
#!/usr/bin/env bash
set -u
count=0
[[ -f "$FAKE_CURL_COUNT" ]] && count="$(<"$FAKE_CURL_COUNT")"
count=$((count + 1))
printf '%s\n' "$count" >"$FAKE_CURL_COUNT"
url="${!#}"
case "${FAKE_CURL_MODE:-complete}" in
  timeout_once)
    if [[ "$count" -eq 1 ]]; then exit 28; fi
    ;;
  timeout)
    exit 28
    ;;
  failed)
    printf '{"job":{"job_id":"job-a","status":"failed","error":"rank failed"}}\n'
    exit 0
    ;;
  successor)
    if [[ "$url" == */job-a ]]; then
      printf '{"job":{"job_id":"job-a","status":"coalesced","successor_job_id":"job-b"}}\n'
    else
      printf '{"job":{"job_id":"job-b","status":"complete"}}\n'
    fi
    exit 0
    ;;
esac
printf '{"job":{"job_id":"job-a","status":"complete"}}\n'
SH
chmod +x "$TMP/curl"

export PATH="$TMP:$PATH"
export FAKE_CURL_COUNT="$TMP/count"
export MANGO_VOD_RECOMMENDATION_JOB_READ_TIMEOUT_SEC=1
export MANGO_VOD_RECOMMENDATION_JOB_READ_RETRY_SEC=0.01

export FAKE_CURL_MODE=timeout_once
output="$(bash "$ROOT/scripts/m3-play/playability/wait-vod-recommendation-jobs.sh" \
  http://catalog job-a 3 2>"$TMP/retry.err")"
[[ "$output" == "job-a:complete" ]]
grep -q 'retrying within 3s budget' "$TMP/retry.err"

printf '0\n' >"$FAKE_CURL_COUNT"
export FAKE_CURL_MODE=successor
output="$(bash "$ROOT/scripts/m3-play/playability/wait-vod-recommendation-jobs.sh" \
  http://catalog job-a 3)"
[[ "$output" == "job-b:complete" ]]

printf '0\n' >"$FAKE_CURL_COUNT"
export FAKE_CURL_MODE=failed
if bash "$ROOT/scripts/m3-play/playability/wait-vod-recommendation-jobs.sh" \
    http://catalog job-a 3 >"$TMP/failed.out" 2>"$TMP/failed.err"; then
  echo "failed recommendation job was accepted" >&2
  exit 1
fi
grep -q 'last-good remains active' "$TMP/failed.err"

printf '0\n' >"$FAKE_CURL_COUNT"
export FAKE_CURL_MODE=timeout
if bash "$ROOT/scripts/m3-play/playability/wait-vod-recommendation-jobs.sh" \
    http://catalog job-a 1 >"$TMP/timeout.out" 2>"$TMP/timeout.err"; then
  echo "permanent recommendation read failure was accepted" >&2
  exit 1
fi
grep -q 'timed out after 1s' "$TMP/timeout.err"

echo "PASS: VOD recommendation waiter retries transient reads and preserves last-good"
