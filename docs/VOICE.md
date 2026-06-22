# mango — voice pipeline

**Status:** ✓ Shipped · **Milestone:** M5 (N5a librarian + N5b AI catalogs)  
**Rule:** Voice **opens** titles on TV — pad **B** plays. No `mango_play`.

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

| Service | Port | Protocol |
|---------|------|----------|
| Launcher | 3000 | HTTP (kiosk) |
| Companion | 3001 | HTTPS (mkcert) |
| Orchestrator | 8765 | WSS (phone) |
| Orchestrator | 8766 | WS loopback (TV HUD) |
| catalog-service | 3020 | HTTP `/voice/*` tools |

| Component | Notes |
|-----------|-------|
| Companion | PTT · 16 kHz PCM · chat UI |
| Orchestrator | STT · LLM agent loop · launcher dispatch |
| Launcher HUD | `voice-hud.ts` — only default TV voice surface |
| STT | Deepgram `nova-3` · `multi` · Hinglish keyterms |
| LLM | `claude-sonnet-4-6` with tools |
| TTS | **Off** — `audio.tts_enabled: false` until M6 ship TV |

---

## Voice librarian (N5a)

Phone PTT → search verified library (or Cinemeta external) → **open detail on TV**.

### Catalog routes (`:3020`)

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest |
| `GET /voice/search?q=` | Verified library |
| `GET /voice/library` | Full browse list |
| `GET /voice/search/external?q=` | Cinemeta fallback |
| `POST /voice/library/notes` | Librarian taste notes |
| `GET /voice/now-playing` | mpv snapshot |

### Orchestrator tools

`mango_search` · `mango_search_external` · `mango_library_overview` · `mango_open_title` · `mango_navigate` · `mango_playability_refresh` (phone confirm) · AI catalog CRUD (N5b)

**Non-goals:** `mango_play` · pause · volume · stream language via voice.

### TV command path

1. Orchestrator `POST http://127.0.0.1:3000/api/voice/command`
2. Launcher polls `/api/voice/commands?after=N`
3. `open_detail` → stop mpv → navigate → ack

---

## Protocol

Client → server: `ptt_start` · `ptt_end` + `pcm_b64` (16 kHz mono int16 LE) · `ptt_cancel` · `ping`

Server → client: `status` · `chat` · `error`

Multi-turn PTT allowed while reply visible (blocked only when `ptt_owner` or voice lock held).

---

## Config

Copy `config/config.example.yaml` → `/etc/mango/config.yaml`

| Setting | Pi default |
|---------|------------|
| `stt.provider` | `deepgram` |
| `stt.model` | `nova-3` |
| `stt.language` | `multi` |
| `audio.tts_enabled` | `false` |
| `audio.overlay_reply_seconds` | `10` |

| Env | Use |
|-----|-----|
| `MANGO_VOICE=1` | Enable voice on stack start |
| `MANGO_ORCH_TLS=1` | WSS on `:8765` |
| `MANGO_TTS_DISABLED=1` | Skip Piper warmup |
| `MANGO_LLM_MOCK=1` / `MANGO_STT_MOCK=1` | Dev without API keys |

Secrets: `/etc/mango/llm.key` · `stt.key` · `~/.config/mango/voice.env`

Hinglish sync on deploy: `python3 scripts/m5-voice/ai/sync-hinglish-stt-config.py`

---

## Pi setup

```bash
cd ~/mango && git pull
bash scripts/m5-voice/stack/setup-mkcert.sh
bash scripts/m5-voice/stack/install-voice-deps.sh
bash scripts/m5-voice/stack/install-orchestrator-deps.sh
# llm.key + stt.key + config.yaml in /etc/mango/
cp config/voice.env.example ~/.config/mango/voice.env
bash scripts/mango-stack.sh restart
```

Phone: `https://<pi-ip>:3001`  
Verify: `bash scripts/m5-voice/stack/verify-voice-ready.sh`  
Gate: `bash scripts/m5-voice/ai/gate-m5-voice.sh`

### Phone CA trust

Run `setup-mkcert.sh` · install `rootCA.pem` on phone. Mic requires trusted HTTPS.

---

## Dev

```bash
MANGO_LLM_MOCK=1 MANGO_STT_MOCK=1 MANGO_TTS_DISABLED=1 bash scripts/m5-voice/stack/start-orchestrator.sh
cd src/companion && npm install && npm run dev
```


### N5c — living librarian (partial) ✓

Profile + companion memory tools in manifest when `MANGO_VOICE=1`:

| Tool | Purpose |
|------|---------|
| `mango_read_profile` / `mango_patch_profile` | Household taste profile |
| `mango_companion_summary` | Session context for LLM |
| `mango_append_session_notes` | Post-turn session bullets |
| `mango_read/update_librarian_notes` | Cross-session librarian notes |

Post-PTT light reflection: `orchestrator/companion_reflect.py` → `POST /voice/companion/reflect`.

Gates (when voice enabled): `gate-m5-conversation-policy.sh` · `gate-m5-companion-memory.sh` · gardener · LLM policy.

---

## Deferred (M6)

- Piper TTS on TV / soundbar
- Proactive companion HUD (N5c)
- Voice play / transport controls

---

## References

| Doc | Use |
|-----|-----|
| [STATUS.md](STATUS.md) | N5b AI catalogs · gates |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Voice layer boundaries |
| [DECISIONS.md](DECISIONS.md) | Locked voice choices |
