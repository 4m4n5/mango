# Phase 2 — Voice pipeline

**Status:** ✓ Shipped on Pi · partial couch sign-off (2026-06-18)  
**Prerequisite:** Phase 1.5 ✓ — [`phase0-checklist.md`](phase0-checklist.md)  
**Next:** Native TV UX — [`NATIVE_EXPERIENCE.md`](NATIVE_EXPERIENCE.md) on `feat/native-experience`  
**Spec:** [`tasks/phase2-voice-pipeline.md`](tasks/phase2-voice-pipeline.md) · [`DESIGN.md`](DESIGN.md)

## Goal

Phone PTT → transcript → LLM reply → **TV HUD**. Reply dwells ~10 s on TV, then dismisses; full history on phone. Chat only — no media tools (those move to native UX).

## Architecture

```
Phone :3001 HTTPS              Pi
┌─────────────────┐           ┌─────────────────────────────────────┐
│ companion PWA   │──WSS:8765▶│ orchestrator — Deepgram STT → Haiku  │
│ PTT + chat      │           │ optional Piper TTS                     │
└─────────────────┘           │ loopback WS :8766 (plain, TV clients)  │
Launcher :3000                │   launcher voice-hud.ts (+ opt. overlay)│
│ voice-hud.ts    │──WS:8766─▶│                                      │
└─────────────────┘           └─────────────────────────────────────┘
```

**Two WS ports:** phone uses WSS `:8765` (mkcert). TV HUD uses plain `ws://127.0.0.1:8766` — overlay Chromium cannot trust mkcert.

| Service | Port | Protocol |
|---------|------|----------|
| Launcher | 3000 | HTTP (kiosk) |
| Companion | 3001 | HTTPS (mkcert) |
| Orchestrator | 8765 | WSS (phone) |
| Orchestrator | 8766 | WS loopback (TV HUD) |

Launcher and pad stack unchanged from Phase 1.

## What shipped

| Component | Path / port | Notes |
|-----------|-------------|-------|
| Companion | `src/companion` · `:3001` | PTT · 16 kHz PCM · streaming LLM on phone |
| Orchestrator | `src/orchestrator` · `:8765`/`:8766` | Multi-turn PTT · session history |
| TV HUD | `src/launcher/src/voice-hud.ts` | Primary — visible on kiosk |
| Overlay (optional) | `src/overlay` | Secondary HUD Chromium |
| STT | Deepgram `nova-3` + `multi` + keyterms | Local Whisper: `stt.provider: local` |
| LLM | Haiku `claude-haiku-4-5-20251001` | Streaming deltas |
| TTS | Piper | **Off on Pi** — `audio.tts_enabled: false` |

**Ops:** `scripts/phase2/start-voice-stack.sh` · `verify-voice-ready.sh` · `setup-mkcert.sh`  
**Secrets:** `/etc/mango/llm.key` · `stt.key` · `config.yaml` · `~/.config/mango/voice.env`

## Protocol

Client → server: `ptt_start` · `ptt_end` + `pcm_b64` (16 kHz mono int16 LE) · `ptt_cancel` · `ping`

Server → client: `status` (idle/listening/thinking/speaking) · `chat` (user/assistant) · `error`

Orchestrator owns state. Errors broadcast `error`, restore audio duck, return to `idle`. Multi-turn PTT works while reply is on screen (blocked only when `ptt_owner` or voice lock held).

## Config

Copy [`config/config.example.yaml`](../config/config.example.yaml) → `/etc/mango/config.yaml`.

| Setting | Pi default | Notes |
|---------|------------|-------|
| `stt.provider` | `deepgram` | `local` = faster-whisper fallback |
| `stt.model` | `nova-3` | `nova-2` in example yaml |
| `stt.language` | `multi` | Hinglish codeswitch; use keyterms |
| `llm.model` | `claude-haiku-4-5-20251001` | |
| `audio.tts_enabled` | `false` | `true` when HDMI speaker ready |
| `audio.overlay_reply_seconds` | `10` | TV dwell before HUD dismiss |
| `orchestrator.local_ws_port` | `8766` | Plain WS for TV clients |

| Env | Use |
|-----|-----|
| `MANGO_VOICE=1` | Enable voice stack on launcher start |
| `MANGO_TTS_DISABLED=1` | Skip Piper — UI-only replies |
| `MANGO_ORCH_TLS=1` | WSS on `:8765` |
| `MANGO_LLM_MOCK=1` / `MANGO_STT_MOCK=1` | Dev smoke without API keys |

**Deepgram key:** [console.deepgram.com](https://console.deepgram.com/) → API Keys → paste in `/etc/mango/stt.key` (mode `600`). Nova-3 + `multi` for Hinglish; `stt.keyterms` and `stt.prepare_audio: true` improve accuracy.

## Pi setup

```bash
cd ~/mango && git pull
bash scripts/phase2/setup-mkcert.sh
bash scripts/phase2/install-voice-deps.sh
bash scripts/phase2/install-orchestrator-deps.sh
# llm.key + stt.key + config.yaml in /etc/mango/
cp config/voice.env.example ~/.config/mango/voice.env
bash scripts/phase2/start-voice-stack.sh
bash scripts/phase1/restart-mango-ui.sh   # rebuild launcher if needed
```

Phone: `https://<pi-ip>:3001` · verify: `bash scripts/phase2/verify-voice-ready.sh`

### Phone CA trust

Run `setup-mkcert.sh` · install printed `rootCA.pem` on phone (iOS: Settings → Certificate Trust Settings; Android: Install CA certificate). Mic requires trusted HTTPS.

## Dev

```bash
MANGO_LLM_MOCK=1 MANGO_STT_MOCK=1 MANGO_TTS_DISABLED=1 bash scripts/phase2/start-orchestrator.sh
cd src/companion && npm install && npm run dev
```

Phone dev: `bash scripts/phase2/serve-companion-https.sh` (not plain Vite).

## Sign-off (2026-06-18)

| Test | Result |
|------|--------|
| PTT → transcript → reply on phone | ✓ |
| Launcher HUD shows you / mango | ✓ |
| Second PTT while reply on TV | ✓ |
| Hinglish STT accuracy | ✓ |
| C2 app-switch regression with voice | Not re-run |
| Piper on HDMI | Deferred (`tts_enabled: false`) |
| TV black after turn 1 | Reported · not root-caused |

## Known issues

| Issue | Notes |
|-------|-------|
| Dual uvicorn on one FastAPI app (`:8765` + `:8766`) | WS race errors in logs — fix on native UX branch |
| HDMI black screen after PTT | May correlate with `pactl` duck / infoframe WARN — unconfirmed |
| Separate overlay Chromium | Redundant vs launcher HUD — candidate for removal |
| Desktop Stremio/Kodi browse | Product gap — drives native UX branch |

## Exit criteria

- [x] Phone PTT + mic on HTTPS companion
- [x] PCM → Deepgram → transcript on phone
- [x] LLM reply on phone + TV HUD
- [x] HUD states: idle → listening → thinking → speaking → idle → dismiss
- [x] Multi-turn PTT while reply visible
- [ ] Piper on TV HDMI (deferred — no speaker)
- [ ] C2 regression with voice stack enabled

## Out of scope (Phase 2)

LLM tool calling · `stremio-service` · systemd voice units · wake word · room mic · CEC.
