# Phase N3d-S7–S9 — Stream metadata, language modes, Easynews groups

**Status:** Not started  
**Branch:** `feat/native-experience`  
**Prerequisite:** N3d S0–S6 shipped · AIOStreams patch applied · `gate-n3d-streams.sh` PASS  
**Follows:** [phase-n3d-self-hosted-addon-stack.md](phase-n3d-self-hosted-addon-stack.md) · [N3d-AIOSTREAMS-PROFILE.md](../N3d-AIOSTREAMS-PROFILE.md)  
**Precedes:** N3b stream picker UI (launcher consumes `display_label` + structured fields)

---

## 1. Objective

Unlock **quality / language / release** differentiation on the couch **without** N3b picker UI yet:

1. **Parse** AIOStreams formatter output (primarily `lightgdrive`) into structured mango fields + human `display_label`.
2. **Split language policy:** soft preference (rank boost) vs hard filter (query / voice intent).
3. **Configure AIOStreams groups** so Easynews runs only when torrent/debrid cache is thin.

**Success:** evaluation corpus in `config/stream-gate-fixtures.json` passes `gate-n3d-streams.sh` (Shawshank, RRR, Dhurandhar, Panchayat S1E1, India's Got Latent S1E1, SpongeBob S1E1); `?language=Hindi` hard-filters on RRR when indexer tags allow; default list still returns rows with soft `preferred_language`; Easynews group documented and active on Pi.

---

## 2. Non-goals (this phase)

| Out of scope | Phase |
|--------------|-------|
| Launcher stream picker rows (detail UI) | N3b |
| Voice orchestrator wiring (`language` from LLM intent) | N5 / voice follow-up |
| Custom AIOStreams formatter title line | Optional polish — parser is primary |
| AIOLists empty rails fix | Separate catalog data task |
| `progress.db` / resume | N3b / N4 |

---

## 3. Background — measured gap (Pi, 2026-06-19)

| Layer | Streams | Unique `name` | Unique URLs |
|-------|---------|---------------|-------------|
| AIOStreams direct | 12 | 3 | 12 |
| mango `GET /stream` | 3 | 1 | 3 |

`lightgdrive` **description** already contains release group, encode, size, HDR, indexer, and flag-based languages. **`name` is generic** (`[TB⚡] Torrentio 1080p`). Picker and AI need **`display_label`** built from description, not from `name`.

Example description (Shawshank):

```text
📁 The Shawshank Redemption (1994)
🎥 BluRay 🎞️ HEVC 🏷️ SM737
📺 HDR10 • DV 🎧 DD+ • DD 🔊 5.1 • 2.0
📦 8.98 GB ⏱️ 2h:22m:32s 🔍 ThePirateBay
🌐 🇬🇧📝 🇬🇧 / 🇸🇦 / …
```

---

## 4. Division of labor (unchanged)

| Concern | AIOStreams | mango `catalog-service` |
|---------|------------|-------------------------|
| Formatter richness | `lightgdrive` preset | Parse → structured fields |
| Language sort bias | `preferredLanguages` + sort key | Soft boost when `preferred_language` set |
| Hard language filter | — | `language` query / POST body |
| Easynews conditional fetch | **Groups** SEL | — |
| Lab 1080p cap | No upstream cap | `max_quality` |

---

## 5. Deliverable A — Formatter parser (`stream-filters.ts`)

### 5.1 New exported types / fields on `Stream`

Extend enriched stream objects (additive — do not break Stremio shape):

| Field | Type | Example | Source |
|-------|------|---------|--------|
| `display_label` | `string` | `1080p BluRay HEVC · SM737 · 9 GB` | Built from parsed parts |
| `release_group` | `string?` | `SM737` | `🏷️` line or haystack |
| `encode` | `string?` | `HEVC` | `🎞️` line |
| `size_gb` | `number?` | `8.98` | `📦` line |
| `indexer` | `string?` | `ThePirateBay` | `🔍` line |
| `hdr_tags` | `string[]?` | `['HDR10','DV']` | `📺` line |
| `languages` | `string[]` | `['English','Hindi']` | flags + keywords (improved) |

Keep existing: `resolution`, `release_tier`, `debrid_service`, `cache_status`.

### 5.2 Parser strategy — “best available formatter”

Implement `parseFormatterDescription(description: string): ParsedFormatterFields` with this precedence:

1. **lightgdrive** — line-oriented emoji markers (`🎥`, `🎞️`, `🏷️`, `📦`, `🔍`, `🌐`).
2. **Generic fallback** — regex on full haystack (`name` + `title` + `description`) for resolution, release tier, release group tokens, encode, size.
3. **Never throw** — partial parse is OK; `display_label` falls back to `name` or `title` if nothing parsed.

### 5.3 `display_label` format (binding)

```text
{resolution} {release_tier} {encode} · {release_group} · {size_gb} GB
```

Omit empty segments; trim duplicate spaces. Examples:

- `1080p BluRay HEVC · SM737 · 9 GB`
- `1080p BluRay AVC · LAMA · 3 GB`

Do **not** include debrid badge in `display_label` (keep `[TB⚡]` on `name` for scoring).

### 5.4 Flag → language map (minimum)

| Flag / token | Language |
|--------------|----------|
| `🇬🇧`, `eng`, `english` | English |
| `🇮🇳`, `hindi`, `हिंदी` | Hindi |
| `🇯🇵` | Japanese |
| `🇰🇷` | Korean |
| `🇫🇷` | French |
| `🇩🇪` | German |
| `🇪🇸` | Spanish |
| `🇮🇹` | Italian |
| `🇵🇹`, `🇧🇷` | Portuguese |
| `🇷🇺` | Russian |
| `🇸🇦` | Arabic |

Parse `🌐` line: split on `/`, map flags, dedupe.

### 5.5 Tests (required)

Add `src/catalog-service/src/stream-formatter.test.ts` (or colocated `*.test.ts`) using Node `node:test`:

- Shawshank lightgdrive fixture (two distinct release groups).
- Fallback haystack-only stream (no emoji lines).
- Hindi flag line → `languages` includes `Hindi`.
- `display_label` distinct for two fixtures with same `name`.

Wire: `"test": "npm run build && node --test dist/**/*.test.js"` or explicit list in `package.json`.

---

## 6. Deliverable B — Language soft vs hard

### 6.1 API contract (binding)

| Param / body field | Mode | Behavior |
|--------------------|------|----------|
| *(none)* | — | No language exclude; no boost |
| `preferred_language` (query or POST) | **Soft** | +score boost in `streamPlayScore`; **never** exclude rows |
| `language` (query or POST) | **Hard** | Exclude rows where `streamMatchesLanguage` is false; increment `meta.excluded.language_mismatch` |

**Breaking change fix:** Today `preferred_language` hard-filters in `filterAndRankStreams`. Split into:

```typescript
filterOptions: {
  hard_language?: string | null;      // from ?language= / body.language
  preferred_language?: string | null; // soft boost only
}
```

Update:

- `parseFilterOverridesFromQuery` — `language` → hard; `preferred_language` → soft only.
- `filterOverridesFromBody` in `index.ts` — add `language?: string` separate from `preferred_language`.
- `streamPlayScore` — boost when `preferred_language` matches (already partial).
- `filterStreamsForPlay` relaxed pass — clear **hard** language only, not soft pref.

### 6.2 Voice / AI note (document only)

Future voice: “play in Hindi” → POST `{ language: "Hindi" }` (hard).  
“prefer Hindi but English OK” → `{ preferred_language: "Hindi" }` (soft).

---

## 7. Deliverable C — AIOStreams groups (Easynews conditional)

### 7.1 Target topology

| Group | Addons | Condition |
|-------|--------|-----------|
| **1 — Primary** | Torrentio (service-wrapped TB + RD) | always |
| **2 — Usenet** | Easynews Search | `count(cached(previousStreams)) < 3` |

Reference: [AIOStreams groups](https://docs.aiostreams.viren070.me/guides/groups/).

### 7.2 Operator workflow (Pi browser or SSH tunnel)

```bash
ssh -L 3035:127.0.0.1:3035 mango
# open http://127.0.0.1:3035/stremio/configure
```

Configure UI → Addons → Groups:

1. Create group **Primary** with Torrentio (and any wrapped debrid path).
2. Create group **Easynews fallback** with Easynews Search addon.
3. Set group 2 condition: `count(cached(previousStreams)) < 3`.
4. Save / Update user.

### 7.3 Headless follow-up (if schema captured)

After UI setup, `bash scripts/phase-n3d/aiostreams-config.sh get` → extract `groups` JSON → add to `config/aiostreams-groups.example.json` (no secrets) + document in `configure-aiostreams.md`.

**Do not** guess addon internal IDs in patch without a GET backup.

### 7.4 Verification

- `GET /api/v1/user` → `groups` non-null.
- Optional timing: resolve a popular title — if ≥3 cached torrent rows, Easynews should not dominate latency (manual note in inventory).

---

## 8. Gates & acceptance

### 8.1 Automated — `gate-n3d-streams.sh` + `config/stream-gate-fixtures.json`

Evaluation corpus (verified on Pi 2026-06-19):

| Label | Type | ID | Why |
|-------|------|-----|-----|
| Shawshank | movie | `tt0111161` | Western baseline / N1 smoke |
| RRR | movie | `tt8178634` | Indian blockbuster; Hindi audio |
| Dhurandhar | movie | `tt33014583` | 2025 Hindi spy thriller |
| Panchayat | series | `tt12004706:1:1` | India comedy-drama S1E1 |
| India's Got Latent | series | `tt33094114:1:1` | YouTube-origin India series S1E1 |
| SpongeBob | series | `tt0206512:1:1` | Western animation S1E1 |

**Series note:** bare `series/tt…` often 502 — gates use **episode id** `tt…:season:episode`.

Per fixture, `scripts/phase-n3d/validate-stream-response.py` asserts:

- HTTP 200, `streams.length >= min_streams`
- AIOStreams-only sources; no rate-limit URLs; no ElfHosted / standalone Torrentio
- `unique_urls >= min_unique_urls`
- When `MANGO_GATE_REQUIRE_DISPLAY_LABEL=1` (post-S7): every row has `display_label`; `min_unique_display_labels` when configured

After apply:

```bash
bash scripts/phase-n3d/gate-n3d-streams.sh
# Optional post-S7:
MANGO_GATE_REQUIRE_DISPLAY_LABEL=1 bash scripts/phase-n3d/gate-n3d-streams.sh
```

### 8.2 Language gate (new script or inline)

`scripts/phase-n3d/gate-n3d-stream-language.sh`:

```bash
# Default — should return streams (English OK)
curl -sf "http://127.0.0.1:3020/stream/movie/tt0111161" | jq '.streams | length'  # >= 1

# Hard filter nonsense — may return 0 or 502 (document which)
curl -sf "http://127.0.0.1:3020/stream/movie/tt0111161?language=Klingon" && exit 1 || true

# Soft pref — should still return >= 1 English title
curl -sf "http://127.0.0.1:3020/stream/movie/tt0111161?preferred_language=English" | jq '.streams | length'
```

### 8.3 Couch acceptance — backend only (mango-tv-box-expert)

No launcher UI change this phase. Couch test is **API + play regression**:

| # | Test | Pass |
|---|------|------|
| 1 | `gate-n3d-streams.sh` | exit 0 |
| 2 | Shawshank `display_label` distinct ≥2 | automated |
| 3 | Browse → detail → Play (trending-india pick) | ≤15 s, no error string on status line |
| 4 | `gate-n3-play.sh` | exit 0 (no regression) |
| 5 | `pi-exec-gate.sh` from Mac | exit 0 |

---

## 9. Files to touch

| File | Change |
|------|--------|
| `src/catalog-service/src/stream-filters.ts` | Parser, `display_label`, language split |
| `src/catalog-service/src/index.ts` | `language` body field |
| `src/catalog-service/src/core.ts` | Ensure `normalizeStream` → enrich path |
| `src/catalog-service/src/stream-formatter.ts` | **NEW** — parser module (preferred) |
| `src/catalog-service/src/stream-formatter.test.ts` | **NEW** |
| `src/catalog-service/package.json` | test script |
| `scripts/phase-n3d/gate-n3d-streams.sh` | `display_label` assertions |
| `scripts/phase-n3d/gate-n3d-stream-language.sh` | **NEW** |
| `scripts/phase-n3d/configure-aiostreams.md` | Groups section |
| `docs/N3d-AIOSTREAMS-PROFILE.md` | Parser + language API + groups status |
| `docs/N3d-INVENTORY.md` | S7–S9 handoff metrics |
| `config/aiostreams-groups.example.json` | **NEW** optional template |

---

## 10. Pi deploy protocol (binding)

**Git only** — never rsync.

```bash
# Mac
git push origin feat/native-experience
bash scripts/pi-exec-gate.sh

# Or on Pi
cd ~/mango && git pull --ff-only
cd src/catalog-service && npm ci && npm run test && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/gate-n3d-streams.sh
bash scripts/phase-n3d/gate-n3d-stream-language.sh
bash scripts/phase-n3d/gate-n3d-self-hosted.sh
```

---

## 11. Handoff report template

Codex adds to `docs/N3d-INVENTORY.md`:

```markdown
## S7–S9 stream metadata (date)

| Metric | Before | After |
|--------|--------|-------|
| Shawshank unique display_label | 1 | ? |
| Parser unit tests | 0 | ? |
| groups on Pi | null | configured |
| gate-n3d-stream-language | — | PASS |

Couch: Play from browse pick — PASS/FAIL (title, ttff_ms).
```
