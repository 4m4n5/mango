#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# shellcheck source=lib/maintenance-catalog-filters.sh
source "$REPO_DIR/scripts/m3-play/playability/lib/maintenance-catalog-filters.sh"

explicit_filters="$TMP_DIR/explicit.json"
operator_filters="$TMP_DIR/operator.json"
operator_space_filters="$TMP_DIR/operator profile.json"
fake_home="$TMP_DIR/fake home"
home_filters="$fake_home/home-profile.json"
fallback_filters="$TMP_DIR/fallback.json"
malformed_filters="$TMP_DIR/malformed.json"
array_filters="$TMP_DIR/array.json"
voice_env="$TMP_DIR/voice.env"
voice_env_unquoted="$TMP_DIR/voice-unquoted.env"
voice_env_spaces="$TMP_DIR/voice-spaces.env"
voice_env_home="$TMP_DIR/voice-home.env"
voice_env_duplicate="$TMP_DIR/voice-duplicate.env"
voice_env_single_quote="$TMP_DIR/voice-single-quote.env"
voice_env_home_unquoted="$TMP_DIR/voice-home-unquoted.env"
voice_env_unrelated_command="$TMP_DIR/voice-unrelated-command.env"
voice_env_target_command="$TMP_DIR/voice-target-command.env"
voice_env_unreadable="$TMP_DIR/voice-unreadable.env"
missing_voice_env="$TMP_DIR/missing.env"
printf '{"auto_play_probe_ms":11111}\n' >"$explicit_filters"
printf '{"auto_play_probe_ms":10000}\n' >"$operator_filters"
printf '{"auto_play_probe_ms":9000}\n' >"$operator_space_filters"
mkdir -p "$fake_home"
printf '{"auto_play_probe_ms":9500}\n' >"$home_filters"
printf '{"auto_play_probe_ms":8000}\n' >"$fallback_filters"
printf '{"auto_play_probe_ms":\n' >"$malformed_filters"
printf '[]\n' >"$array_filters"

cat >"$voice_env" <<EOF
echo "SECRET_STDOUT_SHOULD_NOT_LEAK"
echo "SECRET_STDERR_SHOULD_NOT_LEAK" >&2
export MANGO_CATALOG_FILTERS="$operator_filters"
export MANGO_UNRELATED_SECRET="do-not-import"
EOF
cat >"$voice_env_unquoted" <<EOF
export MANGO_CATALOG_FILTERS=$operator_filters
EOF
cat >"$voice_env_spaces" <<EOF
export MANGO_CATALOG_FILTERS="$operator_space_filters"
EOF
cat >"$voice_env_home" <<EOF
export MANGO_CATALOG_FILTERS="\${HOME}/home-profile.json"
EOF
cat >"$voice_env_duplicate" <<EOF
export MANGO_CATALOG_FILTERS="$explicit_filters"
export MANGO_CATALOG_FILTERS="$operator_filters"
EOF
cat >"$voice_env_single_quote" <<'EOF'
export MANGO_CATALOG_FILTERS='${HOME}/single\quoted.json'
EOF
cat >"$voice_env_home_unquoted" <<'EOF'
export MANGO_CATALOG_FILTERS=$HOME/home-profile.json
EOF
cat >"$voice_env_unrelated_command" <<EOF
UNRELATED="\$(touch "$TMP_DIR/unrelated-command-executed")"
export MANGO_CATALOG_FILTERS="$operator_filters"
EOF
cat >"$voice_env_target_command" <<'EOF'
export MANGO_CATALOG_FILTERS="$(touch /tmp/mango-target-command-should-not-run)/profile.json"
EOF
printf 'export MANGO_CATALOG_FILTERS="%s"\n' "$operator_filters" >"$voice_env_unreadable"
chmod 000 "$voice_env_unreadable"

resolve_catalog_filters() {
  printf '%s\n' "$fallback_filters"
}

result="$(
  MANGO_VOICE_ENV="$voice_env" \
  MANGO_CATALOG_FILTERS="$explicit_filters" \
  maintenance_resolve_catalog_filters
)"
[[ "$result" == "$explicit_filters" ]]
maintenance_validate_catalog_filters "$result"

result="$(
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$voice_env" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$operator_filters" ]]
[[ "$result" != *SECRET* ]]
maintenance_validate_catalog_filters "$result"

result="$(
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$voice_env_unquoted" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$operator_filters" ]]
maintenance_validate_catalog_filters "$result"

result="$(
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$voice_env_spaces" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$operator_space_filters" ]]
maintenance_validate_catalog_filters "$result"

result="$(
  unset MANGO_CATALOG_FILTERS
  HOME="$fake_home" MANGO_VOICE_ENV="$voice_env_home" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$home_filters" ]]
maintenance_validate_catalog_filters "$result"

result="$(
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$voice_env_duplicate" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$operator_filters" ]]
maintenance_validate_catalog_filters "$result"

result="$(
  unset MANGO_CATALOG_FILTERS
  HOME="$fake_home" MANGO_VOICE_ENV="$voice_env_home_unquoted" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$home_filters" ]]
maintenance_validate_catalog_filters "$result"

single_result="$(
  unset MANGO_CATALOG_FILTERS
  HOME="$fake_home" MANGO_VOICE_ENV="$voice_env_single_quote" maintenance_operator_catalog_filters_from_voice_env
)"
[[ "$single_result" == '${HOME}/single\quoted.json' ]]

result="$(
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$voice_env_unrelated_command" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$operator_filters" ]]
[[ ! -e "$TMP_DIR/unrelated-command-executed" ]]

rm -f /tmp/mango-target-command-should-not-run
if (
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$voice_env_target_command" maintenance_resolve_catalog_filters
) >"$TMP_DIR/target-command.out" 2>"$TMP_DIR/target-command.err"; then
  echo "target command substitution assignment was accepted" >&2
  exit 1
fi
[[ ! -e /tmp/mango-target-command-should-not-run ]]
[[ ! -s "$TMP_DIR/target-command.out" ]]
grep -q 'unsupported MANGO_CATALOG_FILTERS assignment' "$TMP_DIR/target-command.err"
! grep -q 'touch /tmp/mango-target-command-should-not-run' "$TMP_DIR/target-command.err"

if (
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$voice_env_unreadable" maintenance_resolve_catalog_filters
) >"$TMP_DIR/unreadable.out" 2>"$TMP_DIR/unreadable.err"; then
  echo "unreadable voice.env was accepted" >&2
  exit 1
fi
[[ ! -s "$TMP_DIR/unreadable.out" ]]
grep -q 'voice.env read_error' "$TMP_DIR/unreadable.err"
! grep -q "$operator_filters" "$TMP_DIR/unreadable.err"
chmod 600 "$voice_env_unreadable"

result="$(
  unset MANGO_CATALOG_FILTERS
  MANGO_VOICE_ENV="$missing_voice_env" maintenance_resolve_catalog_filters
)"
[[ "$result" == "$fallback_filters" ]]
maintenance_validate_catalog_filters "$result"

if maintenance_validate_catalog_filters "$TMP_DIR/not-found.json" 2>"$TMP_DIR/not-found.err"; then
  echo "missing catalog filters profile was accepted" >&2
  exit 1
fi
grep -q 'not readable' "$TMP_DIR/not-found.err"

if maintenance_validate_catalog_filters "$malformed_filters" 2>"$TMP_DIR/malformed.err"; then
  echo "malformed catalog filters profile was accepted" >&2
  exit 1
fi
grep -q 'invalid catalog filters JSON' "$TMP_DIR/malformed.err"

if maintenance_validate_catalog_filters "$array_filters" 2>"$TMP_DIR/array.err"; then
  echo "non-object catalog filters profile was accepted" >&2
  exit 1
fi
grep -q 'must be a JSON object' "$TMP_DIR/array.err"

if [[ -n "${MANGO_UNRELATED_SECRET:-}" ]]; then
  echo "operator voice.env leaked unrelated variables into caller" >&2
  exit 1
fi

echo "PASS: maintenance catalog-filters profile resolution is explicit, isolated, and quiet"
