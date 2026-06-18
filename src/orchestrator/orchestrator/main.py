"""mango orchestrator — WebSocket status hub (Phase 2.1 scaffold)."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from orchestrator.config import load_settings
from orchestrator.session import SessionState

app = FastAPI(title="mango-orchestrator", version="0.1.0")
session = SessionState()
clients: set[WebSocket] = set()


async def broadcast_status() -> None:
    payload = json.dumps(
        {"type": "status", "state": session.overlay_state, "text": session.overlay_text}
    )
    dead: list[WebSocket] = []
    for ws in clients:
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "service": "mango-orchestrator",
            "overlay_state": session.overlay_state,
            "clients": len(clients),
        }
    )


@app.websocket("/ws")
async def websocket_hub(websocket: WebSocket) -> None:
    await websocket.accept()
    clients.add(websocket)
    await websocket.send_text(
        json.dumps(
            {"type": "status", "state": session.overlay_state, "text": session.overlay_text}
        )
    )
    try:
        while True:
            raw = await websocket.receive_text()
            await handle_client_message(raw)
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(websocket)


async def handle_client_message(raw: str) -> None:
    try:
        msg: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        return
    msg_type = msg.get("type")
    if msg_type == "ptt_start":
        session.set_overlay("listening", "listening…")
        await broadcast_status()
        return
    if msg_type == "ptt_end":
        session.set_overlay("thinking", "thinking…")
        await broadcast_status()
        # Phase 2.3: decode pcm_b64 → whisper → LLM → piper
        placeholder = "Voice pipeline not wired yet — Phase 2.2+."
        session.set_overlay("speaking", placeholder)
        await broadcast_status()
        await asyncio.sleep(0.5)
        session.set_overlay("idle", "idle")
        await broadcast_status()
        return
    if msg_type == "ping":
        await broadcast_status()


def main() -> None:
    import uvicorn

    settings = load_settings()
    parser = argparse.ArgumentParser(description="mango orchestrator")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
