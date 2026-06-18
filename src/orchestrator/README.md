# mango orchestrator

FastAPI hub for phone voice (Phase 2). See [`docs/PHASE2.md`](../../docs/PHASE2.md).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m orchestrator.main --host 127.0.0.1 --port 8765
```

Health: `GET http://127.0.0.1:8765/health`  
WebSocket: `ws://127.0.0.1:8765/ws`
