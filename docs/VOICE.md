# mango — voice pipeline

**Milestone:** M5 · **Rule:** Voice **opens** titles — pad **B** plays. No `mango_play`.

**M5 complete when:** living librarian infrastructure + [M5.5a voice safety contract](tasks/m5-companion-ux-ship.md) both pass. Final companion/HUD polish moves after native YouTube so the UX pass covers all first-class surfaces.

---

## Architecture

```
Phone :3001 HTTPS              Pi
┌─────────────────┐           ┌─────────────────────────────────────┐
│ companion PWA   │──WSS:8765▶│ orchestrator — Deepgram STT → LLM   │
│ PTT + chat      │           │ tools → catalog-service + launcher   │
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
| STT | Deepgram `nova-3` · `multi` · Hinglish keyterms |
| LLM | Tool loop with librarian persona |
| TTS | Off until M6.3 soundbar/TV path validated |

---

## Voice librarian

Phone PTT → search → **open detail on TV**.

### Catalog routes (`:3020`)

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest |
| `GET /voice/search?q=` | Verified library |
| `GET /voice/library` | Full browse list |
| `GET /voice/search/external?q=` | Cinemeta fallback |
| `POST /voice/library/notes` | Taste notes |
| `GET /voice/now-playing` | mpv snapshot |
| `GET /library/saved` / `GET /library/history` | Read-only Saved/history context |
| `POST /library/saved` / `DELETE /library/saved` | Explicit Save/Unsave tools |

### Tools (summary)

`mango_search` · `mango_open_title` · `mango_navigate` · `mango_save_title` · `mango_unsave_title` · AI catalog CRUD · profile/memory tools when voice enabled.

**Non-goals:** `mango_play` · `play_youtube` / `mango_play_youtube` · hide/unhide · pause · volume.

### TV command path

1. Orchestrator `POST /api/voice/command`
2. Launcher polls `/api/voice/commands`
3. `open_detail` → stop mpv → navigate → ack (`tv_seq`)

---

## Living librarian (in progress)

Profile + companion memory when `MANGO_VOICE=1`:

| Tool | Purpose |
|------|---------|
| `mango_read_profile` / `mango_patch_profile` | Household taste |
| `mango_companion_summary` | Session context |
| `mango_append_session_notes` | Post-turn bullets |
| `mango_read/update_librarian_notes` | Cross-session notes |

Post-PTT reflection → `POST /voice/companion/reflect`.

Gates: `gate-m5-conversation-policy.sh` · `gate-m5-companion-memory.sh` · gardener · LLM policy.

---

## M5.5 — companion contract + post-YouTube polish

M5.5a locks the safety contract now: discover does not jump the TV, clear opens wait for `tv_seq`, ambiguous requests stay on phone, and playback remains pad-only. M5.5b finishes phone/HUD polish after M6.2 YouTube. See [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md).

---

## Protocol

`ptt_start` · `ptt_end` + `pcm_b64` (16 kHz mono) · `ptt_cancel` · `ping` → `status` · `chat` · `error`

---

## Config

`/etc/mango/config.yaml` from `config/config.example.yaml`

| Setting | Default |
|---------|---------|
| `stt.model` | `nova-3` |
| `stt.language` | `multi` |
| `audio.tts_enabled` | `false` |
| `audio.overlay_reply_seconds` | `10` |

| Env | Use |
|-----|-----|
| `MANGO_VOICE=1` | Enable on stack start |
| `MANGO_ORCH_TLS=1` | WSS on `:8765` |
| `MANGO_LLM_MOCK=1` | Dev without API keys |

Secrets: `/etc/mango/llm.key` · `stt.key`

---

## Pi setup

```bash
cd ~/mango && git pull
bash scripts/m5-voice/stack/setup-mkcert.sh
bash scripts/m5-voice/stack/install-voice-deps.sh
bash scripts/m5-voice/stack/install-orchestrator-deps.sh
bash scripts/mango-stack.sh restart
```

Phone: `https://<pi-ip>:3001` · Verify: `verify-voice-ready.sh` · Gate: `gate-m5-voice.sh`

---

## Open items

| Item | Milestone | Notes |
|------|-----------|-------|
| Voice safety contract | M5.5a | Tool/persona audit, no false opens, `tv_seq` acks, corpus gates |
| Post-YouTube companion/HUD polish | M5.5b / M6.5 | Make phone/chat/HUD feel like one product across Movies, Series, Live, and YouTube |
| YouTube-aware Save/Unsave context | M6.2 | Current-context and exact-title Save/Unsave should cover native YouTube once that surface exists |
| YouTube voice discovery/open | M6.2 | Voice opens YouTube result/detail; pad **B** starts playback |
| TTS over living-room audio | M6.3 | Requires TV/soundbar path and ducking validation |
| Voice play / transport controls | M6+ | Deferred; current contract is voice opens, pad plays |

## Deferred (M6+)

- Piper TTS on TV / soundbar (M6.3)
- Voice play / transport controls

---

## References

[STATUS.md](STATUS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DECISIONS.md](DECISIONS.md)
