# mango — voice pipeline

**Milestone:** M5 · **Rule:** Voice/text **opens** titles — pad **B** plays. No `mango_play`.

**M5 complete when:** living librarian infrastructure passes gates. M5.5a safety corpus/gates shipped; M5.5b final polish is M6.5.

---

## Architecture

```
Phone :3001 HTTPS              Pi
┌─────────────────┐           ┌─────────────────────────────────────┐
│ companion PWA   │──WSS:8765▶│ orchestrator — STT (voice) → LLM    │
│ text + PTT      │           │ tools → catalog-service + launcher   │
└─────────────────┘           │ loopback WS :8766 → launcher HUD      │
Launcher :3000                └─────────────────────────────────────┘
│ voice-hud.ts    │──WS:8766─▶
└─────────────────┘
```

| Service | Port |
|---------|------|
| Launcher | 3000 |
| Companion | 3001 (HTTPS) |
| Orchestrator | 8765 (WSS) · 8766 (HUD loopback) |
| catalog-service | 3020 `/voice/*` |

| Component | Notes |
|-----------|-------|
| STT | Deepgram `nova-3` · `multi` · voice/PTT only |
| LLM | Tool loop · concierge-curator persona |
| TTS | **Off** — replies are text bubbles; idle immediately after reply |
| Companion | Chat-first UI · collapsible YouTube/On TV · composer + PTT |

---

## Input modes

| Mode | Path |
|------|------|
| **Voice** | `ptt_start` / `ptt_end` + PCM → STT → shared agent turn |
| **Text** | `chat_send` → shared agent turn (no STT/TTS) |

Both share tools, policy, conversation thread, and TV dispatch. Composer blocks only during `listening` / `thinking`, not after reply.

---

## Voice librarian

Search → **open detail on TV** (movies · series · live · YouTube).

### Catalog routes (`:3020`)

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest |
| `GET /voice/search?q=` | Verified VOD **+ full live IPTV catalog** |
| `GET /voice/library` | Full browse list |
| `GET /voice/search/external?q=` | Cinemeta fallback |
| `GET /voice/ai/context` | Mirror: tab · open · now playing |
| `POST /voice/library/notes` | Taste notes |
| `GET /youtube/search?q=` | YouTube videos/channels/playlists |

### Tools (summary)

`mango_search` · `mango_open_title` · `mango_youtube_search` · `mango_open_youtube` · `mango_navigate` · save/unsave · AI catalog CRUD · profile/memory.

**Live TV:** `mango_search` with keywords (`cartoons`, `cricket`, `nickelodeon`) → results with `type: tv`, `tab: live` → `mango_open_title`. Searches all NexoTV sources (AREA69 + free + news + cartoons), not just browse rails.

**YouTube:** search → open on TV; save/unsave videos only; no auto-open on ambiguous hits.

**Non-goals:** `mango_play` · voice playback · hide/unhide · volume.

### TV command path

1. Orchestrator `POST /api/voice/command`
2. Launcher polls `/api/voice/commands`
3. `open_detail` → stop mpv → navigate → ack (`tv_seq`)

---

## Living librarian ◐

Profile + companion memory when `MANGO_VOICE=1`:

| Tool | Purpose |
|------|---------|
| `mango_read_profile` / `mango_patch_profile` | Household taste |
| `mango_companion_summary` | Session context |
| `mango_append_session_notes` | Post-turn bullets |
| `mango_read/update_librarian_notes` | Cross-session notes |

Post-PTT reflection → `POST /voice/companion/reflect`.

---

## Protocol

`ptt_start` · `ptt_end` + `pcm_b64` · `ptt_cancel` · `chat_send` · `ping` → `status` · `chat` · `tool` · `error`

---

## Config

| Setting | Default |
|---------|---------|
| `audio.tts_enabled` | `false` |
| `MANGO_VOICE=1` | Enable stack |
| `MANGO_COMPANION_DIR` | Persona from repo (`config/companion.example/`) |
| `MANGO_TTS_DISABLED=1` | Skip Piper (recommended on Pi) |

Secrets: `/etc/mango/llm.key` · `stt.key`

---

## Pi setup

```bash
cd ~/mango && git pull
bash scripts/m5-voice/stack/setup-mkcert.sh
bash scripts/m5-voice/stack/install-orchestrator-deps.sh
bash scripts/mango-stack.sh restart
```

Phone: `https://<pi-ip>:3001`

**Gates:** `gate-m5-voice.sh` · `gate-m5-companion-couch.sh`

---

## Open items

| Item | Milestone |
|------|-----------|
| Living librarian hardening | M5 |
| Final companion/HUD polish across 4 tabs | M5.5b / M6.5 |
| Piper TTS on TV/soundbar | M6.3 |
| Voice play/transport | M6+ deferred |

---

## References

[AI_LAYER.md](AI_LAYER.md) · [STATUS.md](STATUS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [LIVE_TV.md](LIVE_TV.md)
