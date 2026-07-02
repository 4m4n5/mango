#!/usr/bin/env python3
"""Small X11 playback progress OSD for Mango's VLC couch path."""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path


HOME = Path(os.environ.get("HOME") or "/home/aman")
CACHE_DIR = HOME / ".cache" / "mango"
STATE_PATH = Path(os.environ.get("MANGO_PLAYER_STATE_PATH", CACHE_DIR / "player-state.json"))
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


def _load_state() -> dict[str, object] | None:
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None
    pid = int(float(state.get("pid") or 0))
    if state.get("backend") != "vlc" or not _pid_alive(pid):
        return None
    return state


def _current_position(state: dict[str, object]) -> tuple[float, float, bool]:
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
    except Exception as exc:  # pragma: no cover - runtime package check
        print(f"playback-osd: tkinter unavailable: {exc}", file=sys.stderr)
        return 1

    _write_owner_file(PID_PATH, f"{os.getpid()}\n", 0o644)
    show_until = time.time() + VISIBLE_SEC
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
        height = 104
        x = max(0, int((screen_w - width) / 2))
        y = max(0, screen_h - height - max(34, int(screen_h * 0.035)))
        root.geometry(f"{width}x{height}+{x}+{y}")
        return width, height

    def draw(width: int, height: int, state: dict[str, object]) -> None:
        position, duration, paused = _current_position(state)
        pct = 0.0 if duration <= 0 else max(0.0, min(1.0, position / duration))
        canvas.delete("all")
        pad_x = 34
        track_y = height - 38
        track_w = width - pad_x * 2
        track_h = 10
        title = "Paused" if paused else "Playing"
        if duration > 0:
            time_label = f"{_format_time(position)} / {_format_time(duration)}"
        else:
            time_label = f"{_format_time(position)} / LIVE"
        canvas.create_text(
            pad_x,
            28,
            anchor="w",
            fill="#f7f1df",
            font=("DejaVu Sans", 21, "bold"),
            text=title,
        )
        canvas.create_text(
            width - pad_x,
            28,
            anchor="e",
            fill="#d7c6a0",
            font=("DejaVu Sans", 19),
            text=time_label,
        )
        canvas.create_rectangle(
            pad_x,
            track_y,
            pad_x + track_w,
            track_y + track_h,
            fill="#514b3d",
            outline="",
        )
        canvas.create_rectangle(
            pad_x,
            track_y,
            pad_x + int(track_w * pct),
            track_y + track_h,
            fill="#ffb84c",
            outline="",
        )
        thumb_x = pad_x + int(track_w * pct)
        canvas.create_oval(
            thumb_x - 9,
            track_y - 6,
            thumb_x + 9,
            track_y + track_h + 6,
            fill="#ffe1a3",
            outline="",
        )
        canvas.create_text(
            pad_x,
            height - 14,
            anchor="w",
            fill="#c5bca5",
            font=("DejaVu Sans", 13),
            text="B pause/play   ←/→ seek   Y back",
        )

    def tick() -> None:
        nonlocal hidden, last_trigger_mtime, show_until
        state = _load_state()
        if state is None:
            try:
                PID_PATH.unlink()
            except OSError:
                pass
            root.destroy()
            return

        try:
            trigger_mtime = TRIGGER_PATH.stat().st_mtime
        except OSError:
            trigger_mtime = 0.0
        if trigger_mtime > last_trigger_mtime:
            last_trigger_mtime = trigger_mtime
            show_until = time.time() + VISIBLE_SEC

        visible = time.time() <= show_until
        if visible:
            width, height = layout()
            draw(width, height, state)
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
