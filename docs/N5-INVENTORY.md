# N5 inventory — voice tools (N5a shipped)

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n5/gate-voice-tools.sh` (included in `gate-lite` when `MANGO_VOICE=1`)  
**Couch:** phone PTT at `https://<pi-ip>:3001` — Hinglish open/navigate; **B on remote to play**

---

## Shipped (N5a)

Voice is a **browse + open librarian**, not a playback remote. The agent searches the verified library (and Cinemeta for out-of-library titles), opens detail on the TV, and remembers taste — user presses **B** to play.

### Architecture

```
Phone companion (:3001 HTTPS)
  │ WSS :8765  ptt_start / ptt_end + pcm_b64
  ▼
Orchestrator (FastAPI)
  │ Deepgram nova-3-general · language=multi · detect fallback hi+en
  │ Anthropic tools loop (claude-sonnet-4-6)
  ├─► catalog-service :3020  /voice/* tools (search, library, notes, external)
  └─► launcher :3000         POST /api/voice/command → TV ack (open_detail, tab, …)
Launcher voice-hud (:8766 loopback WS) — status overlay on TV
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| **companion** | Mic capture · 16 kHz PCM · chat UI | STT · LLM · TV dispatch |
| **orchestrator** | PTT state · STT · LLM agent · launcher HTTP dispatch | Catalog data · mpv |
| **catalog-service** | Tool manifest · search · library · librarian notes · now-playing | Opening TV UI |
| **launcher** | Poll voice commands · open detail · stop mpv on title switch | Voice inference |

### Catalog voice API (`:3020`)

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest for orchestrator + gates |
| `GET /voice/search?q=` | Verified library search |
| `GET /voice/library?overview=1` | Rail counts + samples |
| `GET /voice/library` | Full verified browse list |
| `GET /voice/library/notes` | Persistent librarian notes |
| `POST /voice/library/notes` | Replace notes |
| `GET /voice/now-playing` | mpv session snapshot |
| `GET /voice/search/external?q=` | Cinemeta fallback |

### Orchestrator tools (Anthropic)

| Tool | Layer | Notes |
|------|-------|-------|
| `mango_search` | catalog | Verified library first |
| `mango_search_external` | catalog | Cinemeta; optional `queue_missing` |
| `mango_library_overview` | catalog | Recommendations |
| `mango_library_browse` | catalog | Full verified list |
| `mango_read/update_librarian_notes` | catalog | Cross-session taste |
| `mango_now_playing` | catalog | Read-only |
| `mango_library_shuffle` | catalog | Re-pick home posters |
| `mango_playability_refresh` | catalog | Requires phone confirm |
| `mango_open_title` | launcher | **Opens detail only** — ack via `tv_seq` |
| `mango_navigate` | launcher | home · back · settings · tab |

**Explicit non-goals (N5a):** `mango_play` · pause · volume · stream language via voice.

### TV command path

1. Orchestrator `POST http://127.0.0.1:3000/api/voice/command` with `{ type, action, …, seq }`
2. Launcher polls `/api/voice/commands?after=N`
3. `open_detail` → `stopPlaybackForVoice()` (mpv stop + home) → navigate → ack
4. Gates assert launcher foreground + mpv stopped on title switch

Key code: `src/orchestrator/orchestrator/tools/launcher_dispatch.py`, `src/launcher/src/voice-commands.ts`, `src/mango-ui-server/serve.py`.

### Hinglish STT

| Setting | Value |
|---------|-------|
| Model | `nova-3-general` |
| Language | `multi` |
| Strategy | `multilingual_with_detect_fallback` |
| Detect fallback | `hi` + `en` |
| Prep | `prepare_audio: true` · companion `noiseSuppression: false` |

Pi merge: `python3 scripts/phase-n5/sync-hinglish-stt-config.py` (on deploy when `MANGO_VOICE=1`).

### Gates (13 checks)

`scripts/phase-n5/gate-voice-tools.sh` — manifest · search · library · launcher · STT · TV open · title switch.

---

## N5b — AI catalog rails (shipped)

| Artifact | Path |
|----------|------|
| Task doc | [`tasks/phase-n5b-ai-catalogs.md`](tasks/phase-n5b-ai-catalogs.md) |
| Module | `src/catalog-service/src/ai-catalogs/` |
| Gate | `scripts/phase-n5/gate-n5b-ai-catalogs.sh` |

---

## N5c — Living librarian (in progress)

| Artifact | Path |
|----------|------|
| Task doc | [`tasks/phase-n5c-living-librarian.md`](tasks/phase-n5c-living-librarian.md) |
| Scope | Conversation agent + companion memory + profile/journal |

**Milestone N5c.1:** profile + journal + conversation fix (bundled).

---

## Not shipped (N5c+ / N7)

| Feature | Phase |
|---------|-------|
| Voice play / pause / stream language | deferred (B-only forever) |
| Proactive companion HUD | N5c.2 |
| TTS on TV | N7 |

---

## Ops

```bash
bash scripts/pi-deploy.sh --fast --gate
bash scripts/phase-n5/gate-voice-tools.sh
python3 scripts/phase-n5/sync-hinglish-stt-config.py
```
