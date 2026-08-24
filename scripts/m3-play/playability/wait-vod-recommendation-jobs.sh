#!/usr/bin/env bash
# Wait for exact durable VOD recommendation jobs without treating one slow read
# as the whole refresh result.

set -uo pipefail

CATALOG_URL="${1:?catalog URL required}"
JOB_IDS="${2:?comma-separated job IDs required}"
TIMEOUT_SEC="${3:?wait timeout required}"
READ_TIMEOUT_SEC="${MANGO_VOD_RECOMMENDATION_JOB_READ_TIMEOUT_SEC:-5}"
RETRY_DELAY_SEC="${MANGO_VOD_RECOMMENDATION_JOB_READ_RETRY_SEC:-1}"

if ! [[ "$TIMEOUT_SEC" =~ ^[1-9][0-9]*$ && "$READ_TIMEOUT_SEC" =~ ^[1-9][0-9]*$ ]]; then
  echo "VOD recommendation wait/read timeouts must be positive integers" >&2
  exit 2
fi

STATE="$(mktemp)"
trap 'rm -f "$STATE"' EXIT
IFS=',' read -r -a JOB_ID_LIST <<<"$JOB_IDS"
DEADLINE=$((SECONDS + TIMEOUT_SEC))
STATUS="pending"
DETAIL=""

while (( SECONDS < DEADLINE )); do
  : >"$STATE"
  read_failed=0
  for job_id in "${JOB_ID_LIST[@]}"; do
    if ! curl -fsS -m "$READ_TIMEOUT_SEC" \
        "${CATALOG_URL}/recommendations/jobs/${job_id}" >>"$STATE"; then
      echo "VOD recommendation job read delayed for ${job_id}; retrying within ${TIMEOUT_SEC}s budget" >&2
      read_failed=1
      break
    fi
    printf '\n' >>"$STATE"
  done
  if [[ "$read_failed" == "1" ]]; then
    sleep "$RETRY_DELAY_SEC"
    continue
  fi

  line="$(python3 - "$STATE" "$JOB_IDS" <<'PY'
import json
import sys

path, joined_ids = sys.argv[1:]
expected = joined_ids.split(",")
with open(path, encoding="utf-8") as handle:
    payloads = [json.loads(line) for line in handle if line.strip()]
by_id = {}
for payload in payloads:
    job = payload.get("job") if isinstance(payload, dict) else None
    if isinstance(job, dict) and job.get("job_id"):
        by_id[str(job["job_id"])] = job
missing = [job_id for job_id in expected if job_id not in by_id]
if missing:
    print("missing\t" + ",".join(missing))
    raise SystemExit(0)
failed = [
    f"{job_id}:{by_id[job_id].get('error') or 'unknown error'}"
    for job_id in expected
    if by_id[job_id].get("status") == "failed"
]
if failed:
    print("failed\t" + " | ".join(failed).replace("\t", " ").replace("\n", " "))
    raise SystemExit(0)
statuses = {job_id: str(by_id[job_id].get("status") or "unknown") for job_id in expected}
invalid = [f"{job_id}:{status}" for job_id, status in statuses.items()
           if status not in {"queued", "running", "complete", "coalesced"}]
if invalid:
    print("invalid\t" + ",".join(invalid))
    raise SystemExit(0)
next_ids = []
for job_id in expected:
    status = statuses[job_id]
    if status in {"queued", "running"}:
        next_ids.append(job_id)
    elif status == "coalesced":
        successor = str(by_id[job_id].get("successor_job_id") or "").strip()
        if successor:
            next_ids.append(successor)
next_ids = list(dict.fromkeys(next_ids))
if not next_ids:
    print("complete\t" + ",".join(f"{job_id}:{statuses[job_id]}" for job_id in expected))
else:
    print("pending\t"
          + ",".join(f"{job_id}:{statuses[job_id]}" for job_id in expected)
          + "\t" + ",".join(next_ids))
PY
  )"
  NEXT_JOB_IDS=""
  IFS=$'\t' read -r STATUS DETAIL NEXT_JOB_IDS <<<"$line"
  case "$STATUS" in
    complete)
      echo "$DETAIL"
      exit 0
      ;;
    pending)
      if [[ -n "$NEXT_JOB_IDS" && "$NEXT_JOB_IDS" != "$JOB_IDS" ]]; then
        JOB_IDS="$NEXT_JOB_IDS"
        IFS=',' read -r -a JOB_ID_LIST <<<"$JOB_IDS"
      fi
      sleep 1
      ;;
    missing|failed|invalid)
      echo "VOD recommendation refresh $STATUS: $DETAIL; last-good remains active" >&2
      exit 10
      ;;
    *)
      echo "VOD recommendation refresh returned an invalid aggregate status; last-good remains active" >&2
      exit 10
      ;;
  esac
done

echo "VOD recommendation jobs timed out after ${TIMEOUT_SEC}s ($DETAIL); last-good remains active" >&2
exit 10
