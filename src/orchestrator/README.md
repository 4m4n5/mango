# mango orchestrator

FastAPI voice hub. See [docs/PHASE2.md](../../docs/PHASE2.md).

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

**Pi:** `scripts/mango-stack.sh` when `MANGO_VOICE=1`
