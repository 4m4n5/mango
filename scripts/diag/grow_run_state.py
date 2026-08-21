#!/usr/bin/env python3
"""Grow session phase state — written by maintenance, read by grow_monitor."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

STATE_NAME = "grow-run-state.json"
GROW_LOG_NAME = "playability-grow.log"


def cache_dir() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "mango"


def state_path() -> Path:
    override = os.environ.get("MANGO_GROW_RUN_STATE_PATH")
    if override:
        return Path(override).expanduser()
    return cache_dir() / STATE_NAME


def grow_log_path() -> Path:
    return cache_dir() / GROW_LOG_NAME


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_int(name: str) -> int | None:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def read_state() -> dict[str, Any] | None:
    path = state_path()
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return raw if isinstance(raw, dict) else None


def write_state(
    phase: str,
    message: str,
    *,
    mode: str | None = None,
    preset: str | None = None,
    run_id: str | None = None,
    clear: bool = False,
    **extra: Any,
) -> dict[str, Any]:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if clear:
        if path.is_file():
            path.unlink()
        return {}

    previous = read_state() or {}
    run_id_value = run_id or os.environ.get("MANGO_OPS_RUN_ID") or previous.get("run_id")
    same_run = run_id_value is not None and previous.get("run_id") == run_id_value
    state: dict[str, Any] = {
        "updated_at_ms": _now_ms(),
        "run_id": run_id_value,
        "mode": mode or previous.get("mode"),
        "preset": preset or previous.get("preset"),
        "grow_per_pass": _env_int("MANGO_GROW_PER_PASS") or (previous.get("grow_per_pass") if same_run else None),
        "phase": phase,
        "message": message,
    }
    if state["grow_per_pass"] is None:
        del state["grow_per_pass"]
    for key, value in extra.items():
        if value is not None:
            state[key] = value
    path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    return state


def append_grow_log(line: str) -> None:
    path = grow_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"[{stamp}] {line.rstrip()}\n")


def touch_preflight_progress(done: int, total: int, catalog: str) -> None:
    write_state(
        "preflight",
        f"probing sources {done}/{total}",
        preflight_done=done,
        preflight_total=total,
        preflight_catalog=catalog[:80],
    )
    append_grow_log(f"grow-run: preflight {done}/{total} {catalog[:60]}")


def cmd_set(args: argparse.Namespace) -> int:
    extra = {}
    if args.preflight_done is not None:
        extra["preflight_done"] = args.preflight_done
    if args.preflight_total is not None:
        extra["preflight_total"] = args.preflight_total
    write_state(
        args.phase,
        args.message,
        mode=args.mode,
        preset=args.preset,
        run_id=args.run_id,
        **extra,
    )
    if args.log:
        append_grow_log(args.log)
    return 0


def cmd_log(args: argparse.Namespace) -> int:
    append_grow_log(args.message)
    return 0


def cmd_clear(_args: argparse.Namespace) -> int:
    write_state("", "", clear=True)
    return 0


def cmd_show(_args: argparse.Namespace) -> int:
    state = read_state()
    if state is None:
        print("{}")
        return 0
    print(json.dumps(state, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Grow run phase state")
    sub = parser.add_subparsers(dest="command", required=True)

    set_cmd = sub.add_parser("set", help="update grow-run-state.json")
    set_cmd.add_argument("--phase", required=True)
    set_cmd.add_argument("--message", required=True)
    set_cmd.add_argument("--mode")
    set_cmd.add_argument("--preset")
    set_cmd.add_argument("--run-id")
    set_cmd.add_argument("--preflight-done", type=int)
    set_cmd.add_argument("--preflight-total", type=int)
    set_cmd.add_argument("--log", help="also append line to playability-grow.log")
    set_cmd.set_defaults(func=cmd_set)

    log_cmd = sub.add_parser("log", help="append timestamped line to playability-grow.log")
    log_cmd.add_argument("message")
    log_cmd.set_defaults(func=cmd_log)

    sub.add_parser("clear", help="remove grow-run-state.json").set_defaults(func=cmd_clear)
    sub.add_parser("show", help="print state JSON").set_defaults(func=cmd_show)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    args = build_parser().parse_args()
    sys.exit(args.func(args))
