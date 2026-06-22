# Phase 2 scripts

Voice orchestrator + companion HTTPS. See [`docs/VOICE.md`](../../docs/VOICE.md).

| Script | When |
|--------|------|
| `install-voice-deps.sh` | Once — system audio/TLS helpers |
| `install-orchestrator-deps.sh` | Once — Python venv + pip |
| `ensure-orchestrator-venv.sh` | Idempotent — create venv / install missing deps |
| `download-piper-voice.sh` | Once — Piper ONNX voice model |
| `start-orchestrator.sh` | Orchestrator :8765 (WSS) + :8766 (launcher HUD) |
| `verify-voice-ready.sh` | Smoke test voice stack |
| `setup-mkcert.sh` | Once — TLS for phone mic (companion :3001) |
| `serve-companion-https.sh` | Build + serve companion over HTTPS on :3001 |

**Voice diagnosis logs** (Pi: `~/.cache/mango/`):

| File | Contents |
|------|----------|
| `voice-turns.jsonl` | One JSON line per event: `stt`, `agent_reply`, `tool`, `turn_error`, `turn_done` |
| `orchestrator.log` | orchestrator.* INFO (STT previews, warmup, errors) |

Disable with `MANGO_VOICE_LOG=0` or `MANGO_ORCH_LOGGING=0`.
