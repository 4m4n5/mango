# mango — voice pipeline

**Milestone:** M5 · **Rule:** Voice/text **opens** titles — pad **B** plays. No `mango_play`.

**Current state:** the librarian, text/PTT companion, tool safety corpus,
structured picks, TV HUD, and living-memory pipeline are implemented. Earlier
automated/Pi evidence exists, but the consolidated current-revision V1–V12
couch pass remains open. See [COUCH_TEST.md](COUCH_TEST.md).

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

This voice discovery contract is unchanged by launcher unified Search.
Launcher Search has no chatbot, voice transcript, tool execution, or autoplay;
its optional AI expansion endpoint is localhost-only, no-tools, no-history,
structured retrieval support. See [SEARCH.md](SEARCH.md).

### Catalog routes (`:3020`)

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest |
| `GET /voice/search?q=` | Verified VOD **+ full live IPTV catalog** |
| `GET /voice/library` | Full browse list |
| `GET /voice/search/external?q=` | Cinemeta fallback |
| `GET /ai/context` | Mirror: tab · open · now playing |
| `POST /voice/library/notes` | Taste notes |
| `GET /youtube/search?q=` | YouTube videos/channels/playlists |

### Tools (summary)

`mango_search` · `mango_open_title` · `mango_youtube_search` · `mango_open_youtube` · `mango_navigate` · save/unsave · AI catalog CRUD · profile/memory.

**Live TV:** `mango_search` with keywords (`cartoons`, `cricket`, `nickelodeon`) → results with `type: tv`, `tab: live` → `mango_open_title`. Searches all NexoTV sources (AREA69 + free + news + cartoons), not just browse rails.

**YouTube:** search → open on TV; save/unsave videos only; no auto-open on ambiguous hits.

**Non-goals:** `mango_play` · voice playback · hide/unhide · volume.

### Current LAN trust boundary

Companion HTTPS and the orchestrator WSS are LAN-reachable. TLS protects the
transport and the companion proxy exposes only an exact, minimized catalog
capability set, but there is currently no per-device pairing token, client
authentication, or WebSocket origin/session check. Treat the current setup as
a trusted-LAN development boundary: any reachable LAN client can submit
text/PTT/TV actions and the sanitized YouTube connect/disconnect calls.
Per-device pairing, revocation, origin/session enforcement, and abuse limits
remain required before Mango is a household appliance.

### TV command path

1. Orchestrator `POST /api/voice/command`
2. Launcher polls `/api/voice/commands`
3. `open_detail` → stop mpv → navigate → ack (`tv_seq`)

---

## Living librarian ◐

Conversational profile + companion memory when `MANGO_VOICE=1`:

| Tool | Purpose |
|------|---------|
| `mango_read_profile` / `mango_patch_profile` | Librarian familiarity/preferences for conversation and custom curation |
| `mango_companion_summary` | Session context |
| `mango_append_session_notes` | Post-turn bullets |
| `mango_read/update_librarian_notes` | Cross-session notes |

Post-PTT reflection → `POST /voice/companion/reflect`.

This memory is not Household recommendation identity. It has zero influence on
YouTube v2 and is never sent to the StoryDNA content teacher. `library.db`
remains the authority for Fire/Water/Saved/watch recommendation evidence.

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

Deploy the intended revision through the reviewed Git-only flow in
[DEPLOY.md](DEPLOY.md). The current wrapper is blocked for unattended agents by
its branch/SHA and implicit AIOMetadata-mutation gaps. From the resulting exact,
read-back, built Pi checkout:

```bash
cd ~/mango
bash scripts/m5-voice/stack/setup-mkcert.sh
bash scripts/m5-voice/stack/install-orchestrator-deps.sh
bash scripts/mango-stack.sh restart
```

Phone: `https://<pi-ip>:3001`

**Gates:** `gate-m5-voice.sh` · `gate-m5-companion-couch.sh` · `gate-m5-companion-memory.sh`

---

## Open items

| Item | Milestone |
|------|-----------|
| Comprehensive couch sign-off (V1–V12, U1–U9, M1–M3) | M5.5b / M6.5 |
| Piper TTS on TV/soundbar | M6.3 |
| Physical phone/TV coherence, Hinglish, memory familiarity, restart/offline acceptance | M5.5b / M6.5 |
| Wake word, proactive push, raw memory editor | Not in the current product contract |
| Voice play/transport | Non-goal unless the explicit B-to-play safety decision is reopened |

---

## References

[AI_LAYER.md](AI_LAYER.md) · [STATUS.md](STATUS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [LIVE_TV.md](LIVE_TV.md)
