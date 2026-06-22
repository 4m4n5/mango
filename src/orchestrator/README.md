# mango orchestrator

FastAPI voice hub — phone PTT, STT, LLM agent, TV command dispatch. See [docs/VOICE.md](../../docs/VOICE.md) and [docs/STATUS.md](../../docs/STATUS.md).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
MANGO_ORCH_TLS=1 python -m orchestrator.main --host 0.0.0.0 --port 8765
```

| Endpoint | Port | Client |
|----------|------|--------|
| `GET /health` | 8765 | any |
| WSS `/ws` | 8765 | phone companion |
| WS `/ws` | 8766 | launcher HUD (loopback only) |

## Voice pipeline

```
ptt_end (pcm_b64) → decode → Deepgram STT → chat broadcast
  → generate_agent_reply (Anthropic tools) → launcher POST /api/voice/command
  → optional Piper TTS (off on Pi)
```

| Module | Role |
|--------|------|
| `main.py` | PTT state · voice lock · pipeline orchestration |
| `audio/deepgram_stt.py` | nova-3 multi + detect fallback |
| `llm/agent.py` | Tool loop · fast-path open after search |
| `llm/open_intent.py` | Bare-title / Hinglish verb detection |
| `tools/catalog.py` | HTTP to catalog-service `/voice/*` |
| `tools/launcher_dispatch.py` | HTTP to launcher voice command API |
| `tools/voice_nav.py` | Ordinal · sequel · franchise picking |

Toggle tools: `orchestrator.voice_tools_enabled` or `MANGO_VOICE_TOOLS=0`.

**Pi:** `scripts/mango-stack.sh` when `MANGO_VOICE=1` · STT merge: `scripts/m5-voice/ai/sync-hinglish-stt-config.py`
