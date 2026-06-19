#!/usr/bin/env bash
# Shared AIOMetadata helpers for N3d gates and diagnostics.

aiometadata_health_url() {
  echo "http://127.0.0.1:3036/health"
}

aiometadata_configure_url() {
  echo "http://127.0.0.1:3036/configure"
}

aiometadata_export_file() {
  echo "${MANGO_STREMIO_EXPORT:-/etc/mango/stremio-export.json}"
}

aiometadata_manifest_url() {
  local export_file
  export_file="$(aiometadata_export_file)"
  [[ -f "$export_file" ]] || return 1
  python3 - "$export_file" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
for addon in data.get("addons", []):
    if addon.get("name") == "AIOMetadata":
        url = str(addon.get("manifestUrl") or "").strip()
        if url:
            print(url)
            raise SystemExit(0)
raise SystemExit(1)
PY
}

aiometadata_health_ok() {
  curl -sf --max-time 5 "$(aiometadata_health_url)" >/dev/null 2>&1
}

aiometadata_manifest_ok() {
  local manifest_url
  manifest_url="$(aiometadata_manifest_url 2>/dev/null || true)"
  [[ -n "$manifest_url" ]] || return 1
  curl -sf --max-time 8 "$manifest_url" >/dev/null 2>&1
}
