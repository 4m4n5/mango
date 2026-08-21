> **Archived spec** — superseded by [ROADMAP.md](../../ROADMAP.md) / [STATUS.md](../../STATUS.md).
> Shipped status may differ from this doc. Do not implement from here without checking STATUS.

# Phase N5a — Voice tools (browse + open)

**Status:** ✓ Shipped on `feat/native-experience`  
**Inventory:** [`../N5-INVENTORY.md`](../N5-INVENTORY.md)  
**Gate:** `bash scripts/phase-n5/gate-voice-tools.sh`

## Goal

Phone PTT → Hinglish transcript → TV librarian: search verified library, open titles on TV, remember taste — no voice play, no manual ⌂ on title switch.

## Acceptance

- [x] Catalog `/voice/*` + manifest (no `mango_play`)
- [x] Orchestrator tools loop + launcher HTTP dispatch + TV ack
- [x] Title switch stops mpv in place
- [x] Hinglish STT nova-3 multi + detect fallback
- [x] Fast-path nav + external Cinemeta search
- [x] 13-check gate in gate-lite when `MANGO_VOICE=1`

## Out of scope

AI home catalogs (N5b) · voice play (N5c) · TTS (N7)
