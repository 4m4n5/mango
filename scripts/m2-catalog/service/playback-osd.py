#!/usr/bin/env python3
"""X11 playback OSD — times, progress, subtitles (mpv couch path).

Presentation-only: never mutates HDMI mode. Geometry scales to the panel so the
HUD keeps a constant physical footprint (1080p reference) at 1080p and 4K.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


HOME = Path(os.environ.get("HOME") or "/home/aman")
REPO = Path(os.environ.get("MANGO_REPO_DIR", HOME / "mango"))
CACHE_DIR = HOME / ".cache" / "mango"
MPV_SOCKET = Path(os.environ.get("MANGO_MPV_SOCKET", CACHE_DIR / "mpv.sock"))
MPV_IPC_SH = Path(
    os.environ.get("MANGO_MPV_IPC_SH", REPO / "scripts/m2-catalog/service/mpv-ipc.sh")
)
DISPLAY_MODE_SH = Path(
    os.environ.get("MANGO_DISPLAY_MODE_SH", REPO / "scripts/lib/mango-display-mode.sh")
)
TRIGGER_PATH = Path(os.environ.get("MANGO_PLAYBACK_OSD_TRIGGER", CACHE_DIR / "playback-osd.show"))
PID_PATH = Path(os.environ.get("MANGO_PLAYBACK_OSD_PID_FILE", CACHE_DIR / "playback-osd.pid"))
VISIBLE_STATE_PATH = Path(
    os.environ.get("MANGO_PLAYBACK_OSD_VISIBLE_FILE", CACHE_DIR / "playback-osd.visible")
)
VISIBLE_SEC = float(os.environ.get("MANGO_PLAYBACK_OSD_VISIBLE_SEC", "4.0"))
# Visible path: ≤1 Hz — progress crawl without competing with mpv's GPU.
POLL_MS = int(os.environ.get("MANGO_PLAYBACK_OSD_POLL_MS", "1000"))
# When the overlay is hidden (steady-state playback), poll slowly: just enough
# to notice a show-trigger and detect that mpv exited.
HIDDEN_POLL_MS = int(os.environ.get("MANGO_PLAYBACK_OSD_HIDDEN_POLL_MS", "1000"))
DISPLAY_SNAPSHOT_TTL_SEC = float(
    os.environ.get("MANGO_PLAYBACK_OSD_DISPLAY_TTL_SEC", "2.0")
)
# Reference footprint designed at 1080p; scaled by screen_h / 1080 at runtime.
OSD_WIDTH_REF = int(os.environ.get("MANGO_PLAYBACK_OSD_WIDTH", "1280"))
OSD_HEIGHT_REF = int(os.environ.get("MANGO_PLAYBACK_OSD_HEIGHT", "172"))
OSD_MARGIN_BOTTOM_REF = int(os.environ.get("MANGO_PLAYBACK_OSD_MARGIN_BOTTOM", "48"))
OSD_SCALE_REF_H = float(os.environ.get("MANGO_PLAYBACK_OSD_SCALE_REF_H", "1080"))


def _write_owner_file(path: Path, text: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.chmod(tmp, mode)
    tmp.replace(path)
    os.chmod(path, mode)


def _set_visible_state(visible: bool) -> None:
    payload = {"visible": bool(visible), "ts": time.time(), "visible_sec": VISIBLE_SEC}
    _write_owner_file(VISIBLE_STATE_PATH, json.dumps(payload, separators=(",", ":")) + "\n", 0o644)


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


def _playback_snapshot() -> tuple[float, float, bool] | None:
    if not _mpv_active():
        return None
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
    return pos, dur, is_paused


def _video_snapshot() -> str:
    width = _mpv_ipc_property("width")
    height = _mpv_ipc_property("height")
    codec = _mpv_ipc_property("video-codec")
    hwdec = _mpv_ipc_property("hwdec-current")
    parts: list[str] = []
    if isinstance(width, (int, float)) and isinstance(height, (int, float)) and width > 0 and height > 0:
        parts.append(f"{int(width)}×{int(height)}")
    if isinstance(codec, str) and codec.strip():
        parts.append(codec.strip().upper())
    if isinstance(hwdec, str) and hwdec.strip() and hwdec.strip() != "no":
        parts.append(f"hw:{hwdec.strip()}")
    return " · ".join(parts) if parts else "—"


_display_cache: dict[str, object] = {"ts": 0.0, "value": "—"}


def _display_snapshot() -> str:
    now = time.time()
    if now - float(_display_cache["ts"]) < DISPLAY_SNAPSHOT_TTL_SEC:
        return str(_display_cache["value"])
    value = "—"
    if DISPLAY_MODE_SH.is_file():
        try:
            result = subprocess.run(
                ["bash", str(DISPLAY_MODE_SH), "status"],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
                env={**os.environ, "HOME": str(HOME)},
            )
            line = (result.stdout or "").strip().splitlines()
            if line:
                parts = line[0].split()
                if len(parts) >= 2 and "x" in parts[1]:
                    value = parts[1]
        except (OSError, subprocess.TimeoutExpired):
            value = "—"
    _display_cache["ts"] = now
    _display_cache["value"] = value
    return value


def _subtitle_snapshot() -> tuple[bool, str]:
    visible = _mpv_ipc_property("sub-visibility")
    sid = _mpv_ipc_property("sid")
    if visible in (False, "no", 0) or not _track_id_active(sid):
        return False, "Off"
    tracks = _mpv_ipc_property("track-list")
    return True, _track_label_from_list(tracks, sid, "sub", empty_label="Off")


def _audio_snapshot() -> str:
    aid = _mpv_ipc_property("aid")
    tracks = _mpv_ipc_property("track-list")
    return _track_label_from_list(tracks, aid, "audio", empty_label="Default")


def _track_label_from_list(
    tracks: object,
    track_id: object,
    track_type: str,
    *,
    empty_label: str,
) -> str:
    if not _track_id_active(track_id):
        return empty_label
    try:
        track_num = int(track_id)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return empty_label
    if track_num < 0:
        return empty_label
    if not isinstance(tracks, list):
        return f"Track {track_num}"

    for track in tracks:
        if not isinstance(track, dict) or track.get("type") != track_type:
            continue
        if track.get("id") != track_num:
            continue
        lang = str(track.get("lang") or "").strip()
        title = str(track.get("title") or track.get("external-filename") or "").strip()
        codec = str(track.get("codec") or "").strip()
        if title and lang and lang.lower() not in title.lower():
            label = f"{title} ({lang.upper()})"
        elif title:
            label = title
        elif lang:
            label = lang.upper()
        else:
            label = f"Track {track_num}"
        if track_type == "audio" and codec and codec.lower() not in label.lower():
            label = f"{label} · {codec.upper()}"
        return label
    return f"Track {track_num}"


def _track_id_active(track_id: object) -> bool:
    if track_id is None:
        return False
    if isinstance(track_id, str):
        lowered = track_id.strip().lower()
        if lowered in {"", "no", "null"}:
            return False
        try:
            track_id = int(track_id)
        except ValueError:
            return lowered == "auto"
    if isinstance(track_id, (int, float)):
        return int(track_id) > 0
    return False


def _format_time(seconds: float) -> str:
    seconds = max(0, int(seconds))
    hours, rem = divmod(seconds, 3600)
    minutes, sec = divmod(rem, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


def _x11_env() -> dict[str, str]:
    env = {**os.environ, "HOME": str(HOME)}
    env.setdefault("DISPLAY", ":0")
    env.setdefault("XAUTHORITY", str(HOME / ".Xauthority"))
    return env


def _x11_display_size() -> tuple[int, int]:
    """Actual X11 desktop pixels — prefer xrandr mode over xdotool (stale after mode switch)."""
    if DISPLAY_MODE_SH.is_file():
        try:
            result = subprocess.run(
                ["bash", str(DISPLAY_MODE_SH), "status"],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
                env=_x11_env(),
            )
            if result.returncode == 0:
                mode = result.stdout.strip().split(maxsplit=1)[-1]
                size = mode.split("@", 1)[0]
                if "x" in size:
                    w_str, h_str = size.split("x", 1)
                    w, h = int(w_str), int(h_str)
                    if w > 0 and h > 0:
                        return w, h
        except (OSError, subprocess.TimeoutExpired, ValueError, IndexError):
            pass
    if shutil.which("xdotool"):
        try:
            result = subprocess.run(
                ["xdotool", "getdisplaygeometry"],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
                env=_x11_env(),
            )
            if result.returncode == 0:
                parts = result.stdout.strip().split()
                if len(parts) >= 2:
                    w, h = int(parts[0]), int(parts[1])
                    if w > 0 and h > 0:
                        return w, h
        except (OSError, subprocess.TimeoutExpired, ValueError):
            pass
    return 1920, 1080


def _panel_scale(screen_h: int) -> float:
    ref = OSD_SCALE_REF_H if OSD_SCALE_REF_H > 0 else 1080.0
    scale = float(screen_h) / ref
    return max(1.0, min(2.0, scale))


def _scaled_layout(screen_w: int, screen_h: int) -> dict[str, int]:
    scale = _panel_scale(screen_h)
    width = max(640, int(round(OSD_WIDTH_REF * scale)))
    height = max(120, int(round(OSD_HEIGHT_REF * scale)))
    margin = max(24, int(round(OSD_MARGIN_BOTTOM_REF * scale)))
    width = min(width, max(640, screen_w - 40))
    return {
        "width": width,
        "height": height,
        "margin": margin,
        "pad_x": max(24, int(round(34 * scale))),
        "font_elapsed": max(16, int(round(21 * scale))),
        "font_remain": max(14, int(round(19 * scale))),
        "font_row": max(12, int(round(15 * scale))),
        "font_meta": max(11, int(round(14 * scale))),
        "font_legend": max(10, int(round(13 * scale))),
        "track_h": max(8, int(round(10 * scale))),
        "thumb": max(7, int(round(9 * scale))),
        "row1": max(20, int(round(24 * scale))),
        "row2": max(40, int(round(48 * scale))),
        "row3": max(58, int(round(70 * scale))),
        "row4": max(76, int(round(92 * scale))),
        "row5": max(94, int(round(114 * scale))),
        "track_y_from_bottom": max(28, int(round(40 * scale))),
        "legend_from_bottom": max(10, int(round(12 * scale))),
    }


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
    _set_visible_state(False)
    show_until = 0.0
    last_trigger_mtime = 0.0
    hidden = True
    layout_applied = False
    last_layout_screen: tuple[int, int] | None = None
    last_draw_key: tuple[object, ...] | None = None
    layout_metrics: dict[str, int] = _scaled_layout(1920, 1080)

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
        nonlocal layout_metrics, last_layout_screen
        screen_w, screen_h = _x11_display_size()
        layout_metrics = _scaled_layout(screen_w, screen_h)
        width = layout_metrics["width"]
        height = layout_metrics["height"]
        x = max(0, (screen_w - width) // 2)
        y = max(0, screen_h - height - layout_metrics["margin"])
        root.geometry(f"{width}x{height}+{x}+{y}")
        root.update_idletasks()
        canvas.configure(width=width, height=height)
        canvas.config(scrollregion=(0, 0, width, height))
        root.update_idletasks()
        last_layout_screen = (screen_w, screen_h)
        return width, height

    def display_size_changed() -> bool:
        return last_layout_screen is not None and last_layout_screen != _x11_display_size()

    def draw(
        width: int,
        height: int,
        position: float,
        duration: float,
        paused: bool,
        *,
        force: bool,
    ) -> None:
        nonlocal last_draw_key
        pct = 0.0 if duration <= 0 else max(0.0, min(1.0, position / duration))
        remaining = max(0.0, duration - position) if duration > 0 else 0.0
        # Bucket position to 1s so we redraw at most once per second unless
        # pause/subs/audio/display labels change.
        pos_bucket = int(position)
        subs_on, subs_label = _subtitle_snapshot()
        audio_label = _audio_snapshot()
        video_label = _video_snapshot()
        display_label = _display_snapshot()
        draw_key = (
            pos_bucket,
            int(duration),
            paused,
            subs_on,
            subs_label,
            audio_label,
            video_label,
            display_label,
            width,
            height,
        )
        if not force and draw_key == last_draw_key:
            return
        last_draw_key = draw_key
        canvas.delete("all")

        m = layout_metrics
        pad_x = m["pad_x"]
        track_y = height - m["track_y_from_bottom"]
        track_w = width - pad_x * 2
        track_h = m["track_h"]

        elapsed_color = "#f7f1df" if not paused else "#c9c2b4"
        remain_color = "#d7c6a0" if not paused else "#a89f8c"
        status_color = "#c5bca5"

        elapsed = _format_time(position)
        remain_label = f"-{_format_time(remaining)}" if duration > 0 else "LIVE"
        subs_state = "On" if subs_on else "Off"

        canvas.create_text(
            pad_x,
            m["row1"],
            anchor="w",
            fill=elapsed_color,
            font=("DejaVu Sans", m["font_elapsed"], "bold"),
            text=elapsed,
        )
        canvas.create_text(
            width - pad_x,
            m["row1"],
            anchor="e",
            fill=remain_color,
            font=("DejaVu Sans", m["font_remain"]),
            text=remain_label,
        )
        canvas.create_text(
            pad_x,
            m["row2"],
            anchor="w",
            fill=status_color,
            font=("DejaVu Sans", m["font_row"]),
            text=f"Subtitles: {subs_state}",
        )
        canvas.create_text(
            width - pad_x,
            m["row2"],
            anchor="e",
            fill=status_color,
            font=("DejaVu Sans", m["font_row"]),
            text=f"Sub: {subs_label}",
        )
        canvas.create_text(
            pad_x,
            m["row3"],
            anchor="w",
            fill=status_color,
            font=("DejaVu Sans", m["font_row"]),
            text=f"Audio: {audio_label}",
        )
        video_color = "#9fd4a8" if any(
            token in video_label for token in ("3840", "2160", "4096")
        ) else status_color
        canvas.create_text(
            pad_x,
            m["row4"],
            anchor="w",
            fill=video_color,
            font=("DejaVu Sans", m["font_meta"]),
            text=f"Video: {video_label}",
        )
        display_color = "#9fd4a8" if any(
            token in display_label for token in ("3840", "2160", "4096")
        ) else "#d4a09f" if "1920" in display_label else status_color
        canvas.create_text(
            pad_x,
            m["row5"],
            anchor="w",
            fill=display_color,
            font=("DejaVu Sans", m["font_meta"]),
            text=f"Display: {display_label}",
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
        thumb = m["thumb"]
        canvas.create_oval(
            thumb_x - thumb,
            track_y - 6,
            thumb_x + thumb,
            track_y + track_h + 6,
            fill="#ffe1a3" if not paused else "#b8a88a",
            outline="",
        )
        canvas.create_text(
            pad_x,
            height - m["legend_from_bottom"],
            anchor="w",
            fill="#c5bca5",
            font=("DejaVu Sans", m["font_legend"]),
            text="B pause   ←/→ seek   ↑ osd/subs   A audio   ± vol   Y back",
        )

    def tick() -> None:
        nonlocal hidden, last_trigger_mtime, show_until, layout_applied, last_draw_key

        try:
            trigger_mtime = TRIGGER_PATH.stat().st_mtime
        except OSError:
            trigger_mtime = 0.0
        trigger_fired = trigger_mtime > last_trigger_mtime
        if trigger_fired:
            last_trigger_mtime = trigger_mtime
            show_until = time.time() + VISIBLE_SEC
            layout_applied = False
            last_draw_key = None

        visible = show_until > 0 and time.time() <= show_until

        if not visible:
            if not _mpv_active():
                try:
                    PID_PATH.unlink()
                except OSError:
                    pass
                try:
                    VISIBLE_STATE_PATH.unlink()
                except OSError:
                    pass
                root.destroy()
                return
            if not hidden:
                root.withdraw()
                hidden = True
                layout_applied = False
                last_draw_key = None
                _set_visible_state(False)
            root.after(HIDDEN_POLL_MS, tick)
            return

        snapshot = _playback_snapshot()
        if snapshot is None:
            try:
                PID_PATH.unlink()
            except OSError:
                pass
            try:
                VISIBLE_STATE_PATH.unlink()
            except OSError:
                pass
            root.destroy()
            return

        position, duration, paused = snapshot
        if hidden:
            root.deiconify()
            hidden = False
            layout_applied = False
            last_draw_key = None
            _set_visible_state(True)
        force_draw = trigger_fired or not layout_applied
        if trigger_fired or not layout_applied or display_size_changed():
            width, height = layout()
            layout_applied = True
            force_draw = True
        else:
            width, height = layout_metrics["width"], layout_metrics["height"]
        draw(width, height, position, duration, paused, force=force_draw)
        root.lift()
        root.after(POLL_MS, tick)

    def cleanup(*_: object) -> None:
        try:
            PID_PATH.unlink()
        except OSError:
            pass
        try:
            VISIBLE_STATE_PATH.unlink()
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
