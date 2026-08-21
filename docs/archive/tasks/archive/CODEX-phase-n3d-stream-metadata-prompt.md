# Codex — Phase N3d-S7–S9 implementation checklist

**Branch:** `feat/native-experience`  
**Spec:** [`phase-n3d-stream-metadata.md`](phase-n3d-stream-metadata.md)  
**Profile:** [`N3d-AIOSTREAMS-PROFILE.md`](../N3d-AIOSTREAMS-PROFILE.md)

Execute slices **in order**. One logical commit per slice. After each slice: `npm run test` + `npm run build` if TS touched → commit → push → Pi pull → run slice gate.

Apply **`$mango-tv-box-expert`**: couch acceptance table in spec §8.3; git-only Pi deploy; `pi-exec-gate.sh` before handoff; no secrets in git.

---

## N3d-S7 — Formatter parser + `display_label`

**Goal:** Distinct human-readable rows from AIOStreams `lightgdrive` descriptions.

### Tasks

- [ ] Add `src/catalog-service/src/stream-formatter.ts`:
  - `parseFormatterDescription(description: string): ParsedFormatterFields`
  - `buildDisplayLabel(fields, stream): string`
  - Flag → language map per spec §5.4
- [ ] Update `enrichStreamMetadata()` in `stream-filters.ts` to call parser (description first, haystack fallback).
- [ ] Export new fields on stream objects returned from `GET /stream`.
- [ ] Add `stream-formatter.test.ts` with Shawshank fixtures (≥4 test cases per spec §5.5).
- [ ] Update `package.json` test script to run formatter tests.
- [ ] Extend `gate-n3d-streams.sh` via `config/stream-gate-fixtures.json` + `validate-stream-response.py`:
  - Corpus: Shawshank, RRR, Dhurandhar, Panchayat S1E1, India's Got Latent S1E1, SpongeBob S1E1
  - Require `display_label` when `MANGO_GATE_REQUIRE_DISPLAY_LABEL=1`

### Gate

```bash
cd src/catalog-service && npm run test && npm run build
bash scripts/phase-n3d/gate-n3d-streams.sh
```

### Pi

```bash
cd ~/mango && git pull --ff-only
cd src/catalog-service && npm ci && npm run test && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/gate-n3d-streams.sh
```

### Commit message

```
N3d-S7: parse AIOStreams formatter into display_label for stream rows
```

---

## N3d-S8 — Language soft preference vs hard filter

**Goal:** Default browse shows all languages; `preferred_language` boosts; `language` excludes.

### Tasks

- [ ] Split `filterAndRankStreams` options: `hard_language` vs `preferred_language`.
- [ ] Remove hard exclude from `preferred_language` path (boost only in `streamPlayScore`).
- [ ] `parseFilterOverridesFromQuery`:
  - `language` → hard filter field (new override key or map to `hard_language`).
  - `preferred_language` → soft only.
- [ ] `filterOverridesFromBody` in `index.ts`:
  - Add `language?: string` for hard filter.
  - Keep `preferred_language` as soft.
- [ ] Extend `StreamFilterOverrides` type + `mergeFilterConfig` plumbing.
- [ ] Add `scripts/phase-n3d/gate-n3d-stream-language.sh`.
- [ ] Document API in `src/catalog-service/README.md` and `N3d-AIOSTREAMS-PROFILE.md` § Future-ready.

### Gate

```bash
cd src/catalog-service && npm run test && npm run build
bash scripts/phase-n3d/gate-n3d-stream-language.sh
bash scripts/phase-n3d/gate-n3d-streams.sh   # regression
```

### Commit message

```
N3d-S8: split hard language filter from soft preferred_language boost
```

---

## N3d-S9 — AIOStreams groups (Easynews conditional)

**Goal:** Easynews only when `< 3` cached streams from primary group.

### Tasks

- [ ] Update `scripts/phase-n3d/configure-aiostreams.md` — step-by-step Groups UI with SEL condition.
- [ ] On Pi (operator or Codex via tunnel): configure groups per spec §7.1.
- [ ] `aiostreams-config.sh get` → save redacted `groups` structure to `config/aiostreams-groups.example.json` (no credentials).
- [ ] Update `docs/N3d-AIOSTREAMS-PROFILE.md` — mark Groups as **configured** with condition text.
- [ ] Update `docs/N3d-INVENTORY.md` § S7–S9 handoff.
- [ ] Optional: add groups to `aiostreams-target-patch.json` **only if** validated via PUT without 400.

### Gate

```bash
source ~/.config/mango/aiostreams.credentials
curl -sf -u "$AIOSTREAMS_UUID:$AIOSTREAMS_PASSWORD" http://127.0.0.1:3035/api/v1/user \
  | python3 -c "import json,sys; g=json.load(sys.stdin)['data']['userData'].get('groups'); assert g, 'groups still null'"
bash scripts/phase-n3d/gate-n3d-streams.sh
```

### Commit message

```
N3d-S9: document and enable AIOStreams Easynews fallback group
```

---

## N3d-S7–S9 — Integration handoff

**Goal:** Full pre-couch gate green.

- [ ] `bash scripts/phase-n3/gate-n3-play.sh` — no play regression
- [ ] `bash scripts/phase-n2/gate-n2-browse.sh` — browse regression
- [ ] `bash scripts/phase-n3d/gate-n3d-self-hosted.sh`
- [ ] From Mac: `bash scripts/pi-exec-gate.sh`
- [ ] Inventory handoff table in `docs/N3d-INVENTORY.md`

### Do not stop until

```bash
bash scripts/pi-exec-gate.sh
```

…exit 0, **or** failures documented with explicit user action.

---

## Debugging cheatsheet

| Symptom | Check |
|---------|-------|
| `display_label` all identical | Parser not reading `description`; log first stream `description` on Pi |
| `display_label` missing | `enrichStreamMetadata` not wired in `normalizeStream` / `filterAndRankStreams` |
| Language gate fails soft path | `preferred_language` still hard-filtering — grep `language_mismatch` |
| Groups PUT 400 | Use UI first; capture schema from GET after UI save |
| SEL apply 400 | `keyword(streams, 'all', 'term')` — attributes before keywords |

---

## References

- [AIOStreams groups](https://docs.aiostreams.viren070.me/guides/groups/)
- [Stream expressions](https://docs.aiostreams.viren070.me/reference/stream-expressions/)
- [Android TV — design for TV](https://developer.android.com/design/ui/tv/guides/foundations/design-for-tv) (picker density / 10-ft legibility)
