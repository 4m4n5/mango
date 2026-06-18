"""mango orchestrator — WebSocket voice hub."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from orchestrator.audio.duck import duck_audio, restore_audio
from orchestrator.audio.ingest import decode_pcm_b64
from orchestrator.audio.piper_tts import speak_reply
from orchestrator.audio.whisper_stt import transcribe
from orchestrator.config import load_settings
from orchestrator.llm.provider import generate_reply
from orchestrator.session import ChatMessage, SessionState

app = FastAPI(title="mango-orchestrator", version="0.1.0")
session = SessionState()
clients: set[WebSocket] = set()
voice_lock = asyncio.Lock()
ptt_owner: WebSocket | None = None
listening_timeout_task: asyncio.Task[None] | None = None
voice_epoch = 0


async def broadcast_status() -> None:
    await broadcast({"type": "status", "state": session.overlay_state, "text": session.overlay_text})


async def broadcast_chat(message: ChatMessage) -> None:
    await broadcast({"type": "chat", "role": message.role, "text": message.text})


async def broadcast_error(message: str) -> None:
    await broadcast({"type": "error", "message": message})


async def broadcast(payload: dict[str, Any]) -> None:
    encoded = json.dumps(payload)
    dead: list[WebSocket] = []
    for ws in list(clients):
        try:
            await ws.send_text(encoded)
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
            await handle_client_message(websocket, raw)
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(websocket)
        if ptt_owner is websocket:
            await fail_to_idle("phone disconnected")


async def handle_client_message(websocket: WebSocket, raw: str) -> None:
    global ptt_owner
    try:
        msg: dict[str, Any] = json.loads(raw)
    except json.JSONDecodeError:
        return
    msg_type = msg.get("type")
    if msg_type == "ptt_start":
        if ptt_owner is not None or session.overlay_state != "idle":
            await broadcast_error("voice is busy")
            return
        ptt_owner = websocket
        session.set_overlay("listening", "listening…")
        await broadcast_status()
        settings = load_settings()
        start_listening_timeout(websocket, settings.max_utterance_seconds + 5)
        await asyncio.to_thread(duck_audio, settings)
        return
    if msg_type == "ptt_cancel":
        if ptt_owner is websocket:
            await fail_to_idle("push-to-talk cancelled")
        return
    if msg_type == "ptt_end":
        if ptt_owner is not websocket:
            await broadcast_error("push-to-talk is not active")
            return
        ptt_owner = None
        cancel_listening_timeout()
        if voice_lock.locked():
            await broadcast_error("voice is already processing")
            return
        pcm_b64 = msg.get("pcm_b64")
        if not isinstance(pcm_b64, str) or not pcm_b64:
            await fail_to_idle("missing microphone audio")
            return
        session.set_overlay("thinking", "queued…")
        await broadcast_status()
        asyncio.create_task(run_voice_pipeline(pcm_b64))
        return
    if msg_type == "ping":
        await broadcast_status()


async def run_voice_pipeline(pcm_b64: str) -> None:
    settings = load_settings()
    epoch = voice_epoch
    async with voice_lock:
        try:
            if epoch != voice_epoch:
                return
            session.set_overlay("thinking", "transcribing…")
            await broadcast_status()
            await asyncio.to_thread(restore_audio)
            audio = await asyncio.to_thread(
                decode_pcm_b64, pcm_b64, settings.max_utterance_seconds
            )
            if epoch != voice_epoch:
                return
            transcript = await asyncio.to_thread(transcribe, audio.samples, settings)
            user_message = session.add_message("user", transcript)
            await broadcast_chat(user_message)

            if epoch != voice_epoch:
                return
            session.set_overlay("thinking", "thinking…")
            await broadcast_status()
            reply = await asyncio.to_thread(
                generate_reply, session.provider_messages(), settings
            )
            assistant_message = session.add_message("assistant", reply)
            await broadcast_chat(assistant_message)

            if epoch != voice_epoch:
                return
            session.set_overlay("speaking", reply)
            await broadcast_status()
            await asyncio.to_thread(speak_reply, reply, settings)
        except Exception as exc:
            if epoch == voice_epoch:
                await broadcast_error(str(exc))
        finally:
            await asyncio.to_thread(restore_audio)
            if epoch == voice_epoch:
                session.set_overlay("idle", "idle")
                await broadcast_status()


def start_listening_timeout(owner: WebSocket, seconds: int) -> None:
    global listening_timeout_task
    cancel_listening_timeout()
    listening_timeout_task = asyncio.create_task(watch_listening_timeout(owner, seconds))


def cancel_listening_timeout() -> None:
    global listening_timeout_task
    task = listening_timeout_task
    listening_timeout_task = None
    if task is not None and not task.done() and task is not asyncio.current_task():
        task.cancel()


async def watch_listening_timeout(owner: WebSocket, seconds: int) -> None:
    await asyncio.sleep(seconds)
    if ptt_owner is owner:
        await fail_to_idle("listening timed out")


async def fail_to_idle(message: str) -> None:
    global ptt_owner, voice_epoch
    voice_epoch += 1
    ptt_owner = None
    cancel_listening_timeout()
    await asyncio.to_thread(restore_audio)
    await broadcast_error(message)
    session.set_overlay("idle", "idle")
    await broadcast_status()


def main() -> None:
    import uvicorn

    settings = load_settings()
    parser = argparse.ArgumentParser(description="mango orchestrator")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--ssl-certfile", default=settings.ssl_certfile)
    parser.add_argument("--ssl-keyfile", default=settings.ssl_keyfile)
    args = parser.parse_args()
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        ssl_certfile=args.ssl_certfile,
        ssl_keyfile=args.ssl_keyfile,
    )


if __name__ == "__main__":
    main()
