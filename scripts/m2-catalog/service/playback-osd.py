#!/usr/bin/env python3
"""X11 playback OSD — times, progress, subtitles (mpv + VLC couch path)."""

from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


HOME = Path(os.environ.get("HOME") or "/home/aman")
REPO = Path(os.environ.get("MANGO_REPO_DIR", HOME / "mango"))
CACHE_DIR = HOME / ".cache" / "mango"
STATE_PATH = Path(os.environ.get("MANGO_PLAYER_STATE_PATH", CACHE_DIR / "player-state.json"))
MPV_SOCKET = Path(os.environ.get("MANGO_MPV_SOCKET", CACHE_DIR / "mpv.sock"))
MPV_IPC_SH = Path(
    os.environ.get("MANGO_MPV_IPC_SH", REPO / "scripts/m2-catalog/service/mpv-ipc.sh")
)
TRIGGER_PATH = Path(os.environ.get("MANGO_PLAYBACK_OSD_TRIGGER", CACHE_DIR / "playback-osd.show"))
PID_PATH = Path(os.environ.get("MANGO_PLAYBACK_OSD_PID_FILE", CACHE_DIR / "playback-osd.pid"))
VISIBLE_SEC = float(os.environ.get("MANGO_PLAYBACK_OSD_VISIBLE_SEC", "7.0"))
POLL_MS = int(os.environ.get("MANGO_PLAYBACK_OSD_POLL_MS", "250"))


def _write_owner_file(path: Path, text: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.chmod(tmp, mode)
    tmp.replace(path)
    os.chmod(path, mode)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _mpv_ipc_property(name: str) -> Any:
    if not MPV_SOCKET.is_socket() or not MPV_IPC_SH.is_file():
        return None
    try:
        result = subprocess.run(
            ["bash", str(MPV_IPC_SH), "get_property", name],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
            env={**os.environ, "HOME": str(HOME)},
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0 or not result.stdout.strip():
        return None
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    return payload.get("data")


def _mpv_active() -> bool:
    pid = _mpv_ipc_property("pid")
    if isinstance(pid, (int, float)) and _pid_alive(int(pid)):
        return True
    if MPV_SOCKET.is_socket():
        return _mpv_ipc_property("playback-time") is not None
    return False


def _load_vlc_state() -> dict[str, object] | None:
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    pid = int(float(state.get("pid") or 0))
    if state.get("backend") != "vlc" or not _pid_alive(pid):
        return None
    return state


def _vlc_position(state: dict[str, object]) -> tuple[float, float, bool]:
    now_ms = int(time.time() * 1000)
    start_sec = max(0.0, float(state.get("start_sec") or 0))
    duration_sec = max(0.0, float(state.get("duration_sec") or 0))
    paused = bool(state.get("paused"))
    if paused:
        position = start_sec
    else:
        started_at_ms = float(state.get("started_at_ms") or now_ms)
        position = start_sec + max(0.0, (now_ms - started_at_ms) / 1000.0)
    if duration_sec > 0:
        position = min(duration_sec, position)
    return max(0.0, position), duration_sec, paused


def _playback_snapshot() -> tuple[float, float, bool, str] | None:
    if _mpv_active():
        position = _mpv_ipc_property("playback-time")
        duration = _mpv_ipc_property("duration")
        paused = _mpv_ipc_property("pause")
        if position is None:
            return None
        pos = max(0.0, float(position))
        dur = max(0.0, float(duration or 0))
        is_paused = paused in (True, "yes", 1)
        if dur > 0:
            pos = min(dur, pos)
        return pos, dur, is_paused, "mpv"

    state = _load_vlc_state()
    if state is not None:
        pos, dur, is_paused = _vlc_position(state)
        return pos, dur, is_paused, "vlc"
    return None


def _subtitle_snapshot(backend: str) -> tuple[bool, str]:
    if backend != "mpv":
        return False, "VLC · press X to cycle"
    visible = _mpv_ipc_property("sub-visibility")
    sid = _mpv_ipc_property("sid")
    if visible in (False, "no", 0):
        return False, "Off"
    try:
        sid_num = int(sid)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False, "Off"
    if sid_num < 0:
        return False, "Off"

    tracks = _mpv_ipc_property("track-list")
    if not isinstance(tracks, list):
        return True, f"Track {sid_num}"

    for track in tracks:
        if not isinstance(track, dict) or track.get("type") != "sub":
            continue
        if track.get("id") != sid_num:
            continue
        lang = str(track.get("lang") or "").strip()
        title = str(track.get("title") or track.get("external-filename") or "").strip()
        if title and lang and lang.lower() not in title.lower():
            return True, f"{title} ({lang.upper()})"
        if title:
            return True, title
        if lang:
            return True, lang.upper()
        return True, f"Track {sid_num}"
    return True, f"Track {sid_num}"


def _format_time(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, sec = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


def show(reason: str) -> int:
    payload = {"ts": time.time(), "reason": reason}
    _write_owner_file(TRIGGER_PATH, json.dumps(payload, separators=(",", ":")) + "\n", 0o644)
    return 0


def run() -> int:
    try:
        import tkinter as tk
    except Exception as exc:  # pragma: no cover
        print(f"playback-osd: tkinter unavailable: {exc}", file=sys.stderr)
        return 1

    _write_owner_file(PID_PATH, f"{os.getpid()}\n", 0o644)
    show_until = 0.0
    last_trigger_mtime = 0.0
    hidden = True

    root = tk.Tk(className="mango-playback-osd")
    root.title("mango playback osd")
    root.overrideredirect(True)
    root.configure(bg="#060807")
    root.attributes("-topmost", True)
    try:
        root.attributes("-alpha", float(os.environ.get("MANGO_PLAYBACK_OSD_ALPHA", "0.92")))
    except tk.TclError:
        pass

    canvas = tk.Canvas(root, highlightthickness=0, bg="#060807")
    canvas.pack(fill="both", expand=True)

    def layout() -> tuple[int, int]:
        root.update_idletasks()
        screen_w = max(1280, root.winfo_screenwidth())
        screen_h = max(720, root.winfo_screenheight())
        width = min(2200, max(900, int(screen_w * 0.64)))
        height = 118
        x = max(0, int((screen_w - width) / 2))
        y = max(0, screen_h - height - max(34, int(screen_h * 0.035)))
        root.geometry(f"{width}x{height}+{x}+{y}")
        return width, height

    def draw(
        width: int,
        height: int,
        position: float,
        duration: float,
        paused: bool,
        backend: str,
    ) -> None:
        pct = 0.0 if duration <= 0 else max(0.0, min(1.0, position / duration))
        remaining = max(0.0, duration - position) if duration > 0 else 0.0
        subs_on, subs_label = _subtitle_snapshot(backend)
        canvas.delete("all")

        pad_x = 34
        track_y = height - 38
        track_w = width - pad_x * 2
        track_h = 10

        elapsed_color = "#f7f1df" if not paused else "#c9c2b4"
        remain_color = "#d7c6a0" if not paused else "#a89f8c"
        status_color = "#c5bca5"

        elapsed = _format_time(position)
        remain_label = f"-{_format_time(remaining)}" if duration > 0 else "LIVE"
        subs_state = "On" if subs_on else "Off"

        canvas.create_text(
            pad_x,
            24,
            anchor="w",
            fill=elapsed_color,
            font=("DejaVu Sans", 21, "bold"),
            text=elapsed,
        )
        canvas.create_text(
            width - pad_x,
            24,
            anchor="e",
            fill=remain_color,
            font=("DejaVu Sans", 19),
            text=remain_label,
        )
        canvas.create_text(
            pad_x,
            48,
            anchor="w",
            fill=status_color,
            font=("DejaVu Sans", 15),
            text=f"Subtitles: {subs_state}",
        )
        canvas.create_text(
            width - pad_x,
            48,
            anchor="e",
            fill=status_color,
            font=("DejaVu Sans", 15),
            text=f"Language: {subs_label}",
        )
        canvas.create_rectangle(
            pad_x,
            track_y,
            pad_x + track_w,
            track_y + track_h,
            fill="#514b3d",
            outline="",
        )
        fill_w = max(0, int(track_w * pct))
        if fill_w > 0:
            canvas.create_rectangle(
                pad_x,
                track_y,
                pad_x + fill_w,
                track_y + track_h,
                fill="#ffb84c" if not paused else "#8a7a5c",
                outline="",
            )
        thumb_x = pad_x + fill_w
        canvas.create_oval(
            thumb_x - 9,
            track_y - 6,
            thumb_x + 9,
            track_y + track_h + 6,
            fill="#ffe1a3" if not paused else "#b8a88a",
            outline="",
        )
        canvas.create_text(
            pad_x,
            height - 12,
            anchor="w",
            fill="#c5bca5",
            font=("DejaVu Sans", 13),
            text="B pause/play   ←/→ seek   X subs on/off   ↑/↓ language   Y back",
        )

    def tick() -> None:
        nonlocal hidden, last_trigger_mtime, show_until
        snapshot = _playback_snapshot()
        if snapshot is None:
            try:
                PID_PATH.unlink()
            except OSError:
                pass
            root.destroy()
            return

        position, duration, paused, backend = snapshot

        try:
            trigger_mtime = TRIGGER_PATH.stat().st_mtime
        except OSError:
            trigger_mtime = 0.0
        if trigger_mtime > last_trigger_mtime:
            last_trigger_mtime = trigger_mtime
            show_until = time.time() + VISIBLE_SEC

        visible = show_until > 0 and time.time() <= show_until

        if visible:
            width, height = layout()
            draw(width, height, position, duration, paused, backend)
            if hidden:
                root.deiconify()
                hidden = False
            root.lift()
        elif not hidden:
            root.withdraw()
            hidden = True

        root.after(POLL_MS, tick)

    def cleanup(*_: object) -> None:
        try:
            PID_PATH.unlink()
        except OSError:
            pass
        root.destroy()

    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)
    root.withdraw()
    root.after(0, tick)
    root.mainloop()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true", help="run the OSD window loop")
    parser.add_argument("--show", metavar="REASON", help="show the OSD briefly")
    args = parser.parse_args()
    if args.show:
        return show(args.show)
    if args.run:
        return run()
    parser.error("expected --run or --show REASON")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
