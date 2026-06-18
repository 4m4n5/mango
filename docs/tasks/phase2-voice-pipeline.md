# Task spec — Phase 2 voice pipeline (slices 2.2–2.5)

**Repo:** `mango` (`~/Documents/personal/projects/mango` · Pi: `~/mango` @ `10.0.0.174`)  
**Prerequisite:** Phase 1.5 ✓ · Phase 2.1 scaffold landed (`e284462`)  
**Canonical:** [`docs/PHASE2.md`](../PHASE2.md) · [`docs/DESIGN.md`](../DESIGN.md) · [`docs/DECISIONS.md`](../DECISIONS.md)

**Invoke skill:** `$mango-tv-box-expert` at start — literature sweep + KB; couch/orchestration principles apply to overlay latency and failure modes.

---

## 1. Problem

Ship **general voice chat from the couch**: phone hold-to-talk → STT → LLM → TTS on TV, with overlay status on the Pi.

Phase 2.1 exists: orchestrator WS hub with `ptt_start` / `ptt_end` stubs; companion PTT button without mic; overlay parses JSON status. **No audio, no LLM, no TTS, no HTTPS, overlay still off on Pi.**

---

## 2. Goals (exit criteria)

| # | Criterion | Verify |
|---|-----------|--------|
| V1 | Phone mic works over LAN (HTTPS secure context) | `getUserMedia` succeeds on `https://10.0.0.174:…` |
| V2 | PTT → transcript shown on companion | User text after `ptt_end` |
| V3 | LLM reply generated (Anthropic or OpenAI per config) | Assistant text on companion + overlay |
| V4 | Reply spoken on TV HDMI (Piper) | Audible on Pi speakers |
| V5 | Overlay states: idle → listening → thinking → speaking → idle | TV badge during flow |
| V6 | Duck TV audio ~40% while listening | Stremio/Kodi quieter during PTT |
| V7 | Phase 1 unchanged | C2 app switch still works; pad untouched |

**Out of scope (Phase 3):** media tools, `stremio-service`, Kodi RPC play, LLM tool calling, companion D-pad remote.

---

## 3. Architecture (target)

```
Phone  https://<pi>:3001          Pi
┌──────────────────────┐          ┌─────────────────────────────────┐
│ companion PWA        │──wss───▶│ orchestrator :8765 (TLS optional) │
│ getUserMedia 16kHz   │          │  ingest → whisper → LLM → piper  │
│ hold-to-talk         │          │  broadcast status → overlay WS   │
└──────────────────────┘          └─────────────────────────────────┘
                                              │
                                  overlay Chromium (127.0.0.1, ws/wss)
```

### 3.1 Mixed-content rule (critical)

HTTPS companion **cannot** use `ws://` to a different port. Pick one approach and document in `PHASE2.md`:

| Approach | Recommendation |
|----------|----------------|
| **A. TLS on orchestrator** | mkcert on `:8765`; companion `VITE_ORCH_WS=wss://10.0.0.174:8765/ws`; companion static via HTTPS `:3001` (vite preview + certs) |
| **B. Single gateway** | Orchestrator serves companion `dist/` + `/ws` on one HTTPS port |
| **C. Reverse proxy** | Caddy/nginx terminates TLS for 3001 + 8765 |

**Prefer A or B** — minimal moving parts on Pi. Justify choice in `PHASE2.md`.

### 3.2 Audio format (locked)

| Parameter | Value |
|-----------|-------|
| Sample rate | 16 kHz |
| Channels | mono |
| Encoding | int16 LE PCM |
| Transport | base64 in `ptt_end.pcm_b64` (JSON) — upgrade to binary WS frame later if needed |
| Max utterance | 30 s (reject/truncate with user-visible error) |

### 3.3 WebSocket protocol (extend v1)

**Client → server**

```json
{ "type": "ptt_start" }
{ "type": "ptt_end", "pcm_b64": "<base64>" }
{ "type": "ping" }
```

**Server → client**

```json
{ "type": "status", "state": "idle|listening|thinking|speaking", "text": "..." }
{ "type": "chat", "role": "user|assistant", "text": "..." }
{ "type": "error", "message": "..." }
```

On `ptt_end`: decode → STT → append user message → LLM → append assistant → TTS first sentence → broadcast states.

### 3.4 Session

- In-memory conversation per orchestrator process (list of `{role, text}`).
- System prompt: helpful TV assistant; no tools in Phase 2; concise spoken replies.
- Config: [`config/config.example.yaml`](../../config/config.example.yaml) + `/etc/mango/config.yaml` on Pi.

---

## 4. Deliverables

### 4.1 Companion (`src/companion/`)

- [ ] `getUserMedia({ audio: true })` on first PTT (permission prompt once).
- [ ] Capture while button held; resample to 16 kHz mono int16 (AudioWorklet preferred; ScriptProcessor acceptable with comment).
- [ ] Send `pcm_b64` on `ptt_end`.
- [ ] Render `chat` messages (user + assistant) in simple scrollable log.
- [ ] Show connection + mic permission errors clearly.
- [ ] Build for production (`npm run build`).

### 4.2 Orchestrator (`src/orchestrator/`)

- [ ] `audio/ingest.py` — decode base64 PCM → `numpy`/`bytes` buffer.
- [ ] `audio/whisper_stt.py` — faster-whisper `base.en` (lazy load model).
- [ ] `audio/piper_tts.py` — subprocess `piper` → `aplay`/`paplay` on default HDMI sink; stream first sentence.
- [ ] `audio/duck.py` — PulseAudio/PipeWire volume duck ~40% on `ptt_start`, restore on idle (best-effort if no PA).
- [ ] `llm/provider.py` — Anthropic + OpenAI adapters; read API key from `llm.api_key_file`.
- [ ] `session.py` — extend with message history + helpers.
- [ ] `main.py` — wire `ptt_end` pipeline async (don't block WS loop); remove placeholder string.
- [ ] `requirements.txt` — pin reasonable versions (`faster-whisper`, `anthropic`, `openai`, `numpy`).
- [ ] Optional TLS: `--ssl-certfile` / `--ssl-keyfile` or env `MANGO_SSL_*` using mkcert paths.

### 4.3 Scripts (`scripts/phase2/`)

- [ ] `install-orchestrator-deps.sh` — add system deps note (piper, ffmpeg if needed).
- [ ] `install-voice-deps.sh` — apt/brew hints for piper, faster-whisper deps on Pi 5.
- [ ] `start-orchestrator.sh` — support TLS env vars.
- [ ] `serve-companion-https.sh` — build companion + serve with mkcert certs on `:3001`.
- [ ] `setup-mkcert.sh` — improve if needed (document phone trust steps).
- [ ] Optional: `install-orchestrator-systemd.sh` — user unit for orchestrator (don't break mango-ui).

### 4.4 Overlay + Pi integration

- [ ] `src/overlay/` — handle `chat`-style toasts if needed; ensure states readable at 10 ft.
- [ ] `scripts/phase1/start-mango-ui.sh` — gate overlay with env `MANGO_SKIP_OVERLAY=0` when `MANGO_VOICE=1` or document manual toggle.
- [ ] Overlay reconnect if orchestrator restarts.

### 4.5 Docs

- [ ] Update [`docs/PHASE2.md`](../PHASE2.md) — architecture chosen, Pi setup, phone trust CA, verify steps.
- [ ] Update [`docs/DECISIONS.md`](../DECISIONS.md) if TLS/port decisions change.
- [ ] Update [`mango/AGENTS.md`](../../AGENTS.md) — Phase 2 progress.
- [ ] Add verify checklist to PHASE2.md exit criteria (checkboxes).

---

## 5. Implementation principles

1. **Orchestrator owns voice state** — single authority for overlay `status`; no race with launcher.
2. **Fail loud, restore idle** — on STT/LLM/TTS error: `error` message + overlay `idle`; never hang in `thinking`.
3. **Don't block the WS loop** — run STT/LLM/TTS in `asyncio.to_thread` or task queue.
4. **Lazy heavy imports** — load whisper model on first PTT, not at import.
5. **Secrets never in repo** — `/etc/mango/llm.key` only; document setup.
6. **Phase 1 sacred** — do not modify `mango-tv-pad.py`, launch scripts, or gamepad codes unless fixing a voice-specific bug with comment.
7. **Pi 5 realistic** — `base.en` not large-v3; first reply latency target 3–8 s perceived (stream TTS on first sentence per DESIGN.md).

---

## 6. Verification

### Mac (dev)

```bash
bash scripts/phase2/install-orchestrator-deps.sh
# export ANTHROPIC_API_KEY or mock LLM for dev
bash scripts/phase2/start-orchestrator.sh
cd src/companion && npm install && npm run dev
# PTT → expect transcript + reply (or stub LLM in dev without key)
```

### Pi (couch)

```bash
cd ~/mango && git pull
bash scripts/phase2/setup-mkcert.sh
bash scripts/phase2/install-voice-deps.sh
bash scripts/phase2/install-orchestrator-deps.sh
# /etc/mango/config.yaml + llm.key
bash scripts/phase2/start-orchestrator.sh &
bash scripts/phase2/serve-companion-https.sh &
# Phone: trust mkcert CA → https://10.0.0.174:3001
# MANGO_SKIP_OVERLAY=0 bash scripts/phase1/restart-mango-ui.sh
```

**Regression:** run C2 flow (Stremio → ⌂ → YouTube → ⌂ → Stremio) after voice install.

---

## 7. Hard rules

- No secrets in git (`keys/`, `*.key`, `.env`).
- No Phase 3 media tools or tool-calling LLM.
- TypeScript vanilla (no React) for companion/overlay.
- `set -euo pipefail` on bash.
- Match existing code style in `serve.py` and launch scripts.
- Do not commit `node_modules/`, `.venv/`, `dist/` (already gitignored).

---

## 8. When done

Leave a summary:

1. Files added/changed  
2. TLS approach chosen and why  
3. Pi install commands (copy-paste)  
4. Phone CA trust steps  
5. What you could not verify without hardware  
6. Known follow-ups for Phase 3  

Do not ask clarifying questions unless blocked — document assumptions in `PHASE2.md`.
