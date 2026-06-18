# Phase 2 — Voice pipeline

**Status:** In progress (scaffold landed 2026-06-18).  
**Prerequisite:** Phase 1.5 couch acceptance ✓ — see [`phase0-checklist.md`](phase0-checklist.md).  
**Spec:** [`PLAN.md`](PLAN.md) § Phase 2 · [`DESIGN.md`](DESIGN.md) voice/overlay.

## Goal

Phone PTT → transcript → LLM reply → TTS on TV. Overlay shows idle / listening / thinking / speaking.

## Architecture

```
Phone (HTTPS :3001)          Pi
┌─────────────────┐         ┌──────────────────────────────────┐
│ companion PWA   │──WS────▶│ orchestrator :8765               │
│ hold-to-talk    │         │  ├─ ingest PCM                   │
└─────────────────┘         │  ├─ faster-whisper               │
                            │  ├─ LLM (Anthropic/OpenAI)       │
                            │  └─ Piper → aplay (HDMI)         │
                            └───────────┬──────────────────────┘
                                        │ WS status
                            ┌───────────▼──────────────────────┐
                            │ overlay Chromium (re-enable Pi)  │
                            └──────────────────────────────────┘
```

Launcher (`serve.py :3000`) and pad stack are unchanged — orchestrator is additive.

## HTTPS (required for phone mic)

Mobile browsers expose `navigator.mediaDevices` only in a [secure context](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) (HTTPS, localhost, or `file://`). Plain `http://10.0.0.174:3001` will not get mic access.

**V1:** mkcert on Pi — trust root CA once on phone. See `scripts/phase2/setup-mkcert.sh`.

| Service | Port | Protocol |
|---------|------|----------|
| Launcher | 3000 | HTTP (Pi localhost + kiosk) |
| Companion | 3001 | **HTTPS** |
| Orchestrator | 8765 | WS (+ HTTP health) |

## Config

Copy [`config/config.example.yaml`](../config/config.example.yaml) → `/etc/mango/config.yaml` on Pi. Secrets in `/etc/mango/*.key` (never commit).

## Repo layout

```
src/orchestrator/     FastAPI + WebSocket hub
src/companion/        PWA — PTT + connection status
scripts/phase2/       start orchestrator, mkcert, companion HTTPS
```

## Dev (Mac)

```bash
cd src/orchestrator && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m orchestrator.main --host 127.0.0.1 --port 8765

# overlay already connects to ws://127.0.0.1:8765
cd src/companion && npm install && npm run dev   # after HTTPS proxy for phone test
```

## Pi (when wired)

```bash
cd ~/mango && git pull
bash scripts/phase2/install-orchestrator-deps.sh   # once
bash scripts/phase2/start-orchestrator.sh
```

Overlay: set `MANGO_SKIP_OVERLAY=0` in `start-mango-ui.sh` when voice is ready on device.

## WebSocket protocol (v1)

| Message | Direction | Payload |
|---------|-----------|---------|
| `status` | server → overlay + companion | `{ "state": "idle"\|"listening"\|"thinking"\|"speaking", "text"?: string }` |
| `ptt_start` | companion → server | `{}` |
| `ptt_end` | companion → server | `{ "pcm_b64": "..." }` (16 kHz mono int16, Phase 2.2) |
| `chat` | server → companion | `{ "role": "user"\|"assistant", "text": string }` |

Phase 2.1 scaffold: health + status broadcast only. Audio/LLM/TTS wired in 2.2–2.4.

## Exit criteria

- [ ] Phone PTT → transcript visible on companion
- [ ] LLM reply spoken on TV speakers (Piper)
- [ ] Overlay reflects state; toast last reply ~8 s
- [ ] Duck playback ~40% while listening
- [ ] General chat from couch (no media tools yet — Phase 3)

## Next implementation slices

1. **2.1** — orchestrator health + status WS (this scaffold)
2. **2.2** — companion HTTPS + PTT capture → PCM stream
3. **2.3** — faster-whisper + LLM provider
4. **2.4** — Piper TTS + PulseAudio ducking
5. **2.5** — overlay states + re-enable on Pi
