# Phase 2 — Voice pipeline

**Status:** Slices 2.2-2.5 implemented in repo; Pi/audio verification pending.
**Prerequisite:** Phase 1.5 couch acceptance ✓ — see [`phase0-checklist.md`](phase0-checklist.md).  
**Spec:** [`tasks/phase2-voice-pipeline.md`](tasks/phase2-voice-pipeline.md) · [`DESIGN.md`](DESIGN.md) voice/overlay.

## Goal

Phone PTT → transcript → LLM reply → TTS on TV. Overlay shows idle / listening / thinking / speaking.

## Architecture

```
Phone https://<pi>:3001             Pi
┌──────────────────────┐            ┌────────────────────────────────┐
│ companion PWA        │──wss──────▶│ orchestrator :8765             │
│ getUserMedia         │            │  PCM → faster-whisper → LLM    │
│ 16 kHz mono PCM b64  │            │  Piper → paplay/aplay over HDMI│
└──────────────────────┘            └──────────────┬─────────────────┘
                                                    │ ws/wss status
                                      ┌─────────────▼────────────────┐
                                      │ overlay Chromium, opt-in Pi   │
                                      └──────────────────────────────┘
```

Launcher (`serve.py :3000`) and pad stack are unchanged. Phase 2 is chat only; media tools and LLM tool calling start in Phase 3.

## TLS choice

Chosen approach: **A. TLS on orchestrator + HTTPS companion**.

Reason: phone browsers require `getUserMedia()` in a secure context, and an HTTPS page should use WSS for real app WebSocket traffic. Two TLS services keep Phase 1 launcher and app-switching untouched and avoid adding Caddy/nginx before the voice path is stable.

| Service | Port | Protocol |
|---------|------|----------|
| Launcher | 3000 | HTTP on Pi localhost/kiosk |
| Companion | 3001 | HTTPS via mkcert |
| Orchestrator | 8765 | WSS via same mkcert cert when `MANGO_ORCH_TLS=1` |
| Overlay | via launcher `/overlay/` | tries local `ws://127.0.0.1:8765/ws`, then `wss://127.0.0.1:8765/ws` |

Sources: MDN `getUserMedia()` secure-context requirement and MDN WebSocket guidance for HTTPS pages using `wss`.

## Protocol

Client → server:

```json
{ "type": "ptt_start" }
{ "type": "ptt_end", "pcm_b64": "<16kHz mono int16 LE PCM base64>" }
{ "type": "ptt_cancel" }
{ "type": "ping" }
```

Server → client:

```json
{ "type": "status", "state": "idle|listening|thinking|speaking", "text": "..." }
{ "type": "chat", "role": "user|assistant", "text": "..." }
{ "type": "error", "message": "..." }
```

The orchestrator owns state. Any STT, LLM, TTS, audio, or payload error broadcasts `error`, restores ducked audio, and returns overlay state to `idle`.

## Config

Copy [`config/config.example.yaml`](../config/config.example.yaml) to `/etc/mango/config.yaml` on Pi.

Secrets stay outside git:

| Secret | Path |
|--------|------|
| LLM API key | `/etc/mango/llm.key`, mode `600` |
| Kodi/Stremio/TMDB | Existing `/etc/mango/*.key` or JSON files |

Useful dev toggles:

| Env | Use |
|-----|-----|
| `MANGO_LLM_MOCK=1` | Echo mock reply without Anthropic/OpenAI |
| `MANGO_STT_MOCK=1` | Skip faster-whisper; return a fixed transcript (dev smoke) |
| `MANGO_TTS_DISABLED=1` | Skip Piper playback on non-audio dev machines |
| `MANGO_ORCH_TLS=1` | Start orchestrator with mkcert TLS |
| `MANGO_VOICE=1` | Opt Pi launcher startup into overlay Chromium |

## Pi setup

```bash
cd ~/mango && git pull

bash scripts/phase2/setup-mkcert.sh
bash scripts/phase2/install-voice-deps.sh
bash scripts/phase2/install-orchestrator-deps.sh
bash scripts/phase2/download-piper-voice.sh

sudo install -d -m 700 /etc/mango
sudo cp config/config.example.yaml /etc/mango/config.yaml
sudo install -m 600 /dev/null /etc/mango/llm.key
# Put the Anthropic or OpenAI API key into /etc/mango/llm.key on the Pi.

MANGO_ORCH_TLS=1 bash scripts/phase2/start-orchestrator.sh
bash scripts/phase2/serve-companion-https.sh
MANGO_VOICE=1 bash scripts/phase1/restart-mango-ui.sh
```

Open on phone: `https://10.0.0.174:3001`.

## Phone CA trust

Run `bash scripts/phase2/setup-mkcert.sh` on the Pi and note the printed `rootCA.pem`.

iPhone/iPad:

1. Move `rootCA.pem` to the phone through a trusted local route.
2. Open it and install the profile.
3. Enable it in Settings → General → About → Certificate Trust Settings.
4. Visit `https://10.0.0.174:3001`; no certificate warning should appear.

Android:

1. Move `rootCA.pem` to the phone.
2. Settings → Security & privacy → More security settings → Encryption & credentials.
3. Install a CA certificate, then select `rootCA.pem`.
4. Visit `https://10.0.0.174:3001`; no certificate warning should appear.

If the mic prompt does not appear, the page is not a trusted secure context.

## Dev

```bash
bash scripts/phase2/install-orchestrator-deps.sh
MANGO_LLM_MOCK=1 MANGO_STT_MOCK=1 MANGO_TTS_DISABLED=1 bash scripts/phase2/start-orchestrator.sh

cd src/companion
npm install
npm run dev
```

For phone dev, use mkcert and `bash scripts/phase2/serve-companion-https.sh` instead of Vite dev.

## Exit criteria

- [ ] Phone PTT gets mic permission on `https://10.0.0.174:3001`
- [ ] `ptt_end.pcm_b64` arrives as 16 kHz mono int16 LE PCM
- [ ] Transcript appears as `chat.user`
- [ ] LLM reply appears as `chat.assistant`
- [ ] Piper speaks the first sentence on TV HDMI
- [ ] Overlay cycles idle → listening → thinking → speaking → idle
- [ ] Playback is ducked to ~40% while listening and restored before speaking
- [ ] C2 regression still passes: Stremio → home → YouTube → home → Stremio

## Assumptions

- V1 uses mkcert certs trusted on household phones; no reverse proxy yet.
- `piper-tts` Python CLI is acceptable for Phase 2; a persistent Piper server can replace it if load time is too slow.
- faster-whisper uses `base.en`, CPU, `int8`; first use may download/load the model.
- Volume ducking is best-effort through `pactl`; if PulseAudio/PipeWire is absent, voice still works without ducking.
