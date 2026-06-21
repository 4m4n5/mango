# Phase 2 — Voice pipeline

**Status:** ✓ Shipped on Pi · partial couch sign-off (2026-06-18)  
**Prerequisite:** Phase 1.5 ✓ — [`phase0-checklist.md`](phase0-checklist.md)  
**Next:** Native TV UX — [`NATIVE_EXPERIENCE.md`](NATIVE_EXPERIENCE.md) on `feat/native-experience`  
**Spec:** [`tasks/phase2-voice-pipeline.md`](tasks/phase2-voice-pipeline.md) · [`DESIGN.md`](DESIGN.md)

## Goal

Phone PTT → transcript → LLM reply → **TV HUD**. Reply dwells ~10 s on TV, then dismisses; full history on phone. Chat + **N5a voice tools** on native branch — browse/open librarian; play stays on pad B. See [N5-INVENTORY.md](N5-INVENTORY.md).

## Architecture

```
Phone :3001 HTTPS              Pi
┌─────────────────┐           ┌─────────────────────────────────────┐
│ companion PWA   │──WSS:8765▶│ orchestrator — Deepgram STT → Haiku  │
│ PTT + chat      │           │ optional Piper TTS                     │
└─────────────────┘           │ one process: WSS :8765 + WS :8766 loopback │
Launcher :3000                │   launcher voice-hud.ts → :8766        │
│ voice-hud.ts    │──WS:8766─▶│                                      │
└─────────────────┘           └─────────────────────────────────────┘
```

**N0:** overlay Chromium removed. Phone uses WSS `:8765`; launcher HUD uses
loopback `ws://127.0.0.1:8766/ws` in the **same orchestrator process** (asyncio dual
bind — not a second thread).

| Service | Port | Protocol |
|---------|------|----------|
| Launcher | 3000 | HTTP (kiosk) |
| Companion | 3001 | HTTPS (mkcert) |
| Orchestrator | 8765 | WSS (phone) |
| Orchestrator | 8766 | WS loopback (TV HUD only) |

Launcher and pad stack unchanged from Phase 1.

## What shipped

| Component | Path / port | Notes |
|-----------|-------------|-------|
| Companion | `src/companion` · `:3001` | PTT · 16 kHz PCM · streaming LLM on phone |
| Orchestrator | `src/orchestrator` · `:8765` | Multi-turn PTT · session history |
| TV HUD | `src/launcher/src/voice-hud.ts` | Primary — visible on kiosk |
| Overlay (deprecated) | `src/overlay` | Removed from default build/start path in N0 |
| STT | Deepgram `nova-3` + `multi` + keyterms | Local Whisper: `stt.provider: local` |
| LLM | Sonnet `claude-sonnet-4-6` (tools) | Agent loop · catalog + launcher tools |
| TTS | Piper | **Off on Pi** — `audio.tts_enabled: false` |

**Ops:** `scripts/mango-stack.sh` · `scripts/phase2/start-voice-stack.sh` · `verify-voice-ready.sh` · `setup-mkcert.sh`
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
| `audio.tts_enabled` | `false` | `true` at **N7** when 4K TV + soundbar path validated |
| `audio.overlay_reply_seconds` | `10` | TV dwell before HUD dismiss |
| `orchestrator.local_ws_port` | removed | N0 single listener |

| Env | Use |
|-----|-----|
| `MANGO_VOICE=1` | Enable voice stack on launcher start |
| `MANGO_TTS_DISABLED=1` | Skip Piper — UI-only replies |
| `MANGO_ORCH_TLS=1` | WSS on `:8765` |
| `MANGO_SKIP_OVERLAY=1` | N0 default; launcher HUD only |
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
bash scripts/mango-stack.sh restart
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
| Piper on HDMI / soundbar | Deferred (`tts_enabled: false`) — dev lab uses headphones |
| TV black after turn 1 | Reported · not root-caused |

## Known issues

| Issue | Notes |
|-------|-------|
| Dual uvicorn threads on one FastAPI app | Fixed in N0 — asyncio dual bind, one process |
| HDMI black screen after PTT | May correlate with `pactl` duck / infoframe WARN — unconfirmed |
| Separate overlay Chromium | Deprecated in N0; launcher HUD is canonical |
| Desktop Stremio/Kodi browse | Product gap — drives native UX branch |

## Exit criteria

- [x] Phone PTT + mic on HTTPS companion
- [x] PCM → Deepgram → transcript on phone
- [x] LLM reply on phone + TV HUD
- [x] HUD states: idle → listening → thinking → speaking → idle → dismiss
- [x] Multi-turn PTT while reply visible
- [ ] Piper on TV soundbar (deferred — N7; lab: headphones only)
- [ ] C2 regression with voice stack enabled

## Out of scope (Phase 2)

LLM tool calling · `stremio-service` · systemd voice units · wake word · room mic · CEC.
