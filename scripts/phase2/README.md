# Phase 2 scripts

Voice orchestrator + companion HTTPS. See [`docs/PHASE2.md`](../../docs/PHASE2.md).

| Script | When |
|--------|------|
| `install-voice-deps.sh` | Once — system audio/TLS helpers |
| `install-orchestrator-deps.sh` | Once — Python venv + pip |
| `download-piper-voice.sh` | Once — Piper ONNX voice model |
| `start-orchestrator.sh` | Run orchestrator on :8765; set `MANGO_ORCH_TLS=1` for WSS |
| `setup-mkcert.sh` | Once — TLS for phone mic (companion :3001) |
| `serve-companion-https.sh` | Build + serve companion over HTTPS on :3001 |
