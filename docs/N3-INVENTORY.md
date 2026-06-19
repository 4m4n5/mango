# N3 inventory — stream play orchestrator (N3a)

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n3/gate-n3-play.sh`  
**Spec:** [`tasks/phase-n3-stream-orchestrator.md`](tasks/phase-n3-stream-orchestrator.md)

---

## Plan

*(Codex: write implementation plan here before feature code — see spec §1 and CODEX prompt.)*

**Locked scope:** orchestrator backend · filter tiers · pre-resolve · launcher copy · gates. **No picker UI** (N3b).

---

## Metrics (after N3a)

| Metric | Value |
|--------|-------|
| `gate-n3-play.sh` | |
| Browse pick (gate title) | |
| Browse pick `total_ms` | |
| Browse pick `attempts` | |
| Shawshank regression `total_ms` | |
| Filter exclusions (uncached / unknown) | |

---

## Waivers

| ID | Check | Reason | Owner |
|----|-------|--------|-------|
| | | | |

---

## N3-C1 couch note (manual)

**Lab:** 1080p monitor · headphones via monitor 3.5 mm.

- [ ] Title A (browse rail) → Play ≤15 s, picture + audio
- [ ] Title B (different rail) → Play ≤15 s
- [ ] No API error text on status line
- [ ] ⌂ → home < 1 s after play
- [ ] Voice HUD regression (N0 gate)

---

## Handoff to N3b

After N3a couch sign-off:

- Stream picker UI (2–5 options on detail)  
- `progress.db` + Continue rail  
- Optional Torrentio in picker (not auto-play)
