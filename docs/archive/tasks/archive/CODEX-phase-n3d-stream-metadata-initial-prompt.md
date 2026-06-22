# Codex — Phase N3d-S7–S9 initial prompt (paste this first)

**Branch:** `feat/native-experience`  
**Last updated:** 2026-06-19

Copy **everything below the line** into a new Codex session. Then read [`CODEX-phase-n3d-stream-metadata-prompt.md`](CODEX-phase-n3d-stream-metadata-prompt.md) and execute slices **N3d-S7 → S9** in order.

---

You are a **senior TV-box platform engineer** (embedded Linux, leanback UX, Stremio addon protocol, Node catalog-service, Docker on Pi 5, mpv, SRE gates). Implement **Phase N3d-S7–S9 — stream metadata, language modes, Easynews groups** for **mango** on branch `feat/native-experience`.

Invoke **`$mango-tv-box-expert`** thinking: couch-first, content-forward, polish = perceived latency, automated Pi gates before handoff, git-only deploy (never rsync).

## Why we're doing this

AIOStreams `lightgdrive` already returns **rich descriptions** (release group, encode, size, HDR, language flags), but mango exposes **duplicate generic titles** (`[TB⚡] Torrentio 1080p`). N3b picker and future AI need **`display_label` + structured fields** now. Language must be **soft boost by default**, **hard filter only when asked** (`?language=` / voice). Easynews should not run on every resolve — configure **AIOStreams groups**.

## Authoritative docs (read before coding)

1. **Spec (binding):** `docs/tasks/phase-n3d-stream-metadata.md`
2. **Slices:** `docs/tasks/CODEX-phase-n3d-stream-metadata-prompt.md`
3. **AIOStreams profile:** `docs/N3d-AIOSTREAMS-PROFILE.md`
4. **N3d baseline:** `docs/N3d-INVENTORY.md`, `docs/tasks/phase-n3d-self-hosted-addon-stack.md`
5. **Code today:** `src/catalog-service/src/stream-filters.ts`, `core.ts`, `index.ts`
6. **Headless AIOStreams:** `scripts/phase-n3d/aiostreams-config.sh`, `config/aiostreams-target-patch.json`

## Locked product choices (do not overturn)

| Topic | Choice |
|-------|--------|
| Formatter | Keep `lightgdrive` upstream; **parse in mango** (do not require custom AIOStreams title formatter) |
| `display_label` | Human 10-ft legible: `1080p BluRay HEVC · SM737 · 9 GB` |
| Language default | No exclude; all languages visible |
| `preferred_language` | **Soft** — rank boost only |
| `language` | **Hard** — exclude non-matching rows |
| Easynews | Group 2 only when `count(cached(previousStreams)) < 3` |
| Lab cap | Keep `max_quality: 1080p` in catalog-filters |
| Deploy | **Git only** — commit, push, `git pull` on Pi |
| Secrets | Never commit `/etc/mango/*`, `~/.config/mango/*.credentials`, debrid keys |
| Scope | **No launcher picker UI** (N3b) — backend + gates only |

## Known Pi baseline (verify after pull)

- AIOStreams v2.30.3 @ `127.0.0.1:3035` — patch applied (dedup, conjunctive limits, SEL)
- `stremio-export.json`: Cinemeta + AIOStreams + AIOLists only (no standalone Torrentio)
- Shawshank: ~3 streams · RRR: ~5 · Dhurandhar: ~8 · Panchayat/SpongeBob S1E1 resolve · IGL S1E1 thin (1 stream)
- Evaluation corpus: `config/stream-gate-fixtures.json` (6 titles)
- `groups`: **null** (must configure in S9)
- `gate-n3d-streams.sh`: PASS with URL diversity check

## Industry / systems lenses

| Lens | Apply |
|------|-------|
| **10-ft UI** | `display_label` must differ between rows at 3 m — not just URLs ([Android TV design for TV](https://developer.android.com/design/ui/tv/guides/foundations/design-for-tv)) |
| **Leanback density** | 2–8 scannable rows; parser enables N3b without re-fetching indexers |
| **Policy layering** | AIOStreams sorts languages; mango hard-filters only on explicit intent |
| **Pi compute** | Groups reduce Easynews fan-out on cache-heavy titles |
| **mango proven** | Rate-limit URL skip; mpv probe timeouts; couch-safe launcher copy |

## Execution order

**N3d-S7** → **S8** → **S9** per prompt file. One commit per slice.

After each slice on Pi:

```bash
cd ~/mango && git pull --ff-only
cd src/catalog-service && npm ci && npm run test && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/gate-n3d-streams.sh
# S8+: bash scripts/phase-n3d/gate-n3d-stream-language.sh
```

## Verification matrix (mandatory)

| Step | Command | Expect |
|------|---------|--------|
| Unit tests | `cd src/catalog-service && npm run test` | exit 0 |
| Stream gate | `bash scripts/phase-n3d/gate-n3d-streams.sh` | all 6 fixtures in `stream-gate-fixtures.json` PASS |
| Language gate | `bash scripts/phase-n3d/gate-n3d-stream-language.sh` | soft pref returns rows; hard nonsense handled |
| Play regression | `bash scripts/phase-n3/gate-n3-play.sh` | exit 0 |
| Self-hosted | `bash scripts/phase-n3d/gate-n3d-self-hosted.sh` | stream half PASS |
| Mac handoff | `bash scripts/pi-exec-gate.sh` | exit 0 |

### Couch acceptance (manual — document in inventory)

1. Browse → pick a title from `movies-india-trending` (not Shawshank-only).
2. Press Play — status line stays couch-safe (`finding stream…` → `playing…`).
3. Wall clock ≤15 s to first frame.
4. No wallpaper / no launcher flash regression.

## S9 operator — AIOStreams groups

```bash
ssh -L 3035:127.0.0.1:3035 mango
# http://127.0.0.1:3035/stremio/configure
```

- Group 1: Torrentio (service-wrapped)
- Group 2: Easynews Search — condition: `count(cached(previousStreams)) < 3`
- Update user → verify `groups` non-null via `aiostreams-config.sh get`

Export redacted `config/aiostreams-groups.example.json` from GET (no secrets).

## Handoff criteria

Do **not** stop until:

```bash
bash scripts/pi-exec-gate.sh
```

…passes, **or** failures are documented in `docs/N3d-INVENTORY.md` with explicit user action.

Add handoff table (spec §11): Shawshank unique `display_label` before/after, test count, groups status.

## Success in one line

**`GET /stream` rows are human-distinct via `display_label`, language policy is soft-by-default, Easynews is conditional, and Pi gates are green.**

Start by reading the spec + prompt files, summarizing your plan (parser fields, language API split, groups topology), then begin **N3d-S7**.
