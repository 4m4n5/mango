# N5b — voice-managed AI catalog rails

Voice-created home rails with verified playability pools. Max **3 slots per tab** (movies + series). Hidden when empty.

## Placement

After **Continue Watching** and **pinned**, before yaml thematic rails.

## Storage

`/etc/mango/ai-catalogs/slots/*.yaml` (override: `MANGO_AI_CATALOGS_DIR`). Example: [`config/ai-catalogs.example/`](../../config/ai-catalogs.example/).

Each slot is movies-only **or** series-only. Pool growth uses the same `rail_pool` + nightly top-up machinery as curated rails.

## LLM curation hints (`llm_hints`)

| Field | Use |
|-------|-----|
| `theme` / `prompt` | Creation context for voice + top-up |
| `add_ids` | Prioritize titles on next ingest |
| `remove_ids` | Drop from pool on next top-up (cleared after apply) |
| `topup_suggestions` | Natural-language queue for next nightly pass |

## Overflow (4th catalog on a tab)

`POST /voice/ai-catalogs` returns **409** with `overflow_options` when the tab is full. Voice asks once:

1. **replace** — swap an existing slot (`replace_slot_id`)
2. **pin_titles** — pin hand-picked titles to the pinned rail
3. **merge** — merge seeds/sources into another AI rail (`merge_into_slot_id`)

## HTTP (localhost writes)

| Method | Path | Action |
|--------|------|--------|
| GET | `/voice/ai-catalogs` | List slots |
| POST | `/voice/ai-catalogs` | Create |
| POST | `/voice/ai-catalogs/update` | Update/rename/hints |
| POST | `/voice/ai-catalogs/delete` | Delete |
| POST | `/voice/ai-catalogs/refresh` | Top-up one pool now |

## Voice tools

`mango_list/create/update/delete/refresh_ai_catalog` — see [`voice/tools.ts`](../../src/catalog-service/src/voice/tools.ts).

## Gate

`bash scripts/phase-n5/gate-n5b-ai-catalogs.sh` (in gate-lite when `MANGO_CATALOG=1`).
