"""mango orchestrator — WebSocket voice hub."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

from orchestrator.audio.duck import duck_audio, restore_audio
from orchestrator.audio.ingest import decode_pcm_b64
from orchestrator.audio.piper_tts import speak_reply
from orchestrator.audio.stt import transcribe
from orchestrator.config import load_settings
from orchestrator.llm.provider import generate_reply
from orchestrator.session import ChatMessage, SessionState
from orchestrator.timing import voice_stage
from orchestrator.warmup import warmup_voice_stack

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = load_settings()
    await asyncio.to_thread(warmup_voice_stack, settings)
    yield


app = FastAPI(title="mango-orchestrator", version="0.1.0", lifespan=lifespan)
session = SessionState()
clients: set[WebSocket] = set()
voice_lock = asyncio.Lock()
ptt_owner: WebSocket | None = None
listening_timeout_task: asyncio.Task[None] | None = None
voice_epoch = 0


async def broadcast_status() -> None:
    await broadcast({"type": "status", "state": session.overlay_state, "text": session.overlay_text})


async def broadcast_chat(message: ChatMessage, *, partial: bool = False) -> None:
    payload: dict[str, Any] = {"type": "chat", "role": message.role, "text": message.text}
    if partial:
        payload["partial"] = True
    await broadcast(payload)


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
            "voice_busy": voice_lock.locked(),
            "ptt_active": ptt_owner is not None,
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
        if ptt_owner is not None:
            await broadcast_error("voice is busy")
            return
        if voice_lock.locked():
            await broadcast_error("voice is already processing")
            return
        # Allow a new turn while the TV still shows the last reply (overlay != idle).
        bump_voice_epoch()
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
    partial_state = {"text": "", "sent_at": 0.0}

    def on_llm_delta(text: str) -> None:
        partial_state["text"] = text

    async def pump_llm_partials() -> None:
        while True:
            await asyncio.sleep(0.12)
            if epoch != voice_epoch:
                return
            text = partial_state["text"].strip()
            if not text:
                continue
            now = time.monotonic()
            if now - partial_state["sent_at"] < 0.12:
                continue
            partial_state["sent_at"] = now
            session.set_overlay("thinking", text)
            await broadcast_status()
            await broadcast_chat(ChatMessage(role="assistant", text=text), partial=True)

    async with voice_lock:
        pump_task: asyncio.Task[None] | None = None
        showing_reply = False
        try:
            if epoch != voice_epoch:
                return
            session.set_overlay("thinking", "transcribing…")
            await broadcast_status()
            await asyncio.to_thread(restore_audio)
            with voice_stage("decode_pcm"):
                audio = await asyncio.to_thread(
                    decode_pcm_b64, pcm_b64, settings.max_utterance_seconds
                )
            if epoch != voice_epoch:
                return
            with voice_stage("stt"):
                transcript = await asyncio.to_thread(transcribe, audio.samples, settings)
            user_message = session.add_message("user", transcript)
            await broadcast_chat(user_message)

            if epoch != voice_epoch:
                return
            session.set_overlay("thinking", "thinking…")
            await broadcast_status()
            pump_task = asyncio.create_task(pump_llm_partials())
            with voice_stage("llm"):
                reply = await asyncio.to_thread(
                    generate_reply,
                    session.provider_messages(max_turns=settings.llm_history_turns),
                    settings,
                    on_delta=on_llm_delta,
                )
            if pump_task is not None:
                pump_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await pump_task
            assistant_message = session.add_message("assistant", reply)
            await broadcast_chat(assistant_message)

            if epoch != voice_epoch:
                return
            if settings.tts_enabled:
                if settings.tts_async:
                    asyncio.create_task(_speak_async(reply, settings))
                else:
                    session.set_overlay("speaking", reply)
                    await broadcast_status()
                    with voice_stage("tts"):
                        await asyncio.to_thread(speak_reply, reply, settings)
            else:
                session.set_overlay("speaking", reply)
                await broadcast_status()
                showing_reply = True
                asyncio.create_task(_hold_reply_then_idle(settings.overlay_reply_seconds, epoch))
        except Exception as exc:
            if pump_task is not None:
                pump_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await pump_task
            if epoch == voice_epoch:
                await broadcast_error(str(exc))
        finally:
            await asyncio.to_thread(restore_audio)
            if epoch == voice_epoch and not showing_reply:
                session.set_overlay("idle", "idle")
                await broadcast_status()


async def _hold_reply_then_idle(seconds: int, epoch: int) -> None:
    await asyncio.sleep(seconds)
    if epoch != voice_epoch:
        return
    session.set_overlay("idle", "idle")
    await broadcast_status()


async def _speak_async(reply: str, settings: object) -> None:
    from orchestrator.config import OrchestratorSettings

    assert isinstance(settings, OrchestratorSettings)
    try:
        session.set_overlay("speaking", first_sentence(reply))
        await broadcast_status()
        with voice_stage("tts"):
            await asyncio.to_thread(speak_reply, reply, settings)
    except Exception as exc:
        logger.warning("background tts failed: %s", exc)
    finally:
        if session.overlay_state == "speaking":
            session.set_overlay("idle", "idle")
            await broadcast_status()


def first_sentence(text: str) -> str:
    from orchestrator.audio.piper_tts import first_sentence as piper_first_sentence

    return piper_first_sentence(text)


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


def bump_voice_epoch() -> int:
    global voice_epoch
    voice_epoch += 1
    return voice_epoch


async def fail_to_idle(message: str) -> None:
    global ptt_owner
    bump_voice_epoch()
    ptt_owner = None
    cancel_listening_timeout()
    await asyncio.to_thread(restore_audio)
    await broadcast_error(message)
    session.set_overlay("idle", "idle")
    await broadcast_status()


def main() -> None:
    import threading

    import uvicorn

    settings = load_settings()
    parser = argparse.ArgumentParser(description="mango orchestrator")
    parser.add_argument("--host", default=settings.host)
    parser.add_argument("--port", type=int, default=settings.port)
    parser.add_argument("--ssl-certfile", default=settings.ssl_certfile)
    parser.add_argument("--ssl-keyfile", default=settings.ssl_keyfile)
    args = parser.parse_args()

    use_tls = bool(args.ssl_certfile and args.ssl_keyfile)
    local_port = settings.local_ws_port
    if use_tls and local_port and local_port != args.port:
        thread = threading.Thread(
            target=lambda: uvicorn.run(
                app,
                host="127.0.0.1",
                port=local_port,
                log_level="warning",
            ),
            daemon=True,
            name="mango-orch-local-ws",
        )
        thread.start()
        logger.info("local overlay websocket on ws://127.0.0.1:%s/ws", local_port)

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info",
        ssl_certfile=args.ssl_certfile if use_tls else None,
        ssl_keyfile=args.ssl_keyfile if use_tls else None,
    )


if __name__ == "__main__":
    main()
