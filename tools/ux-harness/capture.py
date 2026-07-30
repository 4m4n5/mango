#!/usr/bin/env python3
"""Render every launcher surface at 1920x1080 on a Mac and screenshot it.

Drives the real key grammar the 8BitDo pad sends (arrows, Enter=B, Backspace=Y,
F6/F7=shoulder tabs, F5=X tap, Shift+F5=X hold) against `vite dev`, with the
fixture server standing in for catalog-service.

Every scene declares a DOM expectation and is only saved once that expectation
holds, and each screenshot is checksummed against the others in the run. A scene
that cannot be reached is reported as SKIP rather than silently saving a
duplicate of the previous screen — the failure mode that wasted a Pi capture run.

    python3 tools/ux-harness/capture.py            # all scenes
    python3 tools/ux-harness/capture.py home tabs  # only matching scenes

Output: ~/.cache/mango-ux/local-shots/ (PNGs, manifest.json, index.html).
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

from playwright.sync_api import Error as PWError
from playwright.sync_api import sync_playwright

URL = os.environ.get("MANGO_UX_URL", "http://127.0.0.1:5173/")
OUT = Path(os.environ.get("MANGO_UX_SHOTS", Path.home() / ".cache/mango-ux/local-shots"))
CONTROL = Path(os.environ.get("MANGO_UX_CONTROL", Path.home() / ".cache/mango-ux/control.json"))
SETTLE_MS = int(os.environ.get("MANGO_UX_SETTLE_MS", "700"))

CARD = "#rails .card"
DETAIL = "#detail-view:not(.hidden)"

# name, keys, expectation, options
SCENES: list[dict] = [
    # --- home / browse ---
    dict(name="01-home-movies", keys=[], expect=CARD),
    dict(name="02-home-focus-moved", keys=["ArrowRight", "ArrowRight"], expect=CARD),
    dict(name="03-home-rail-2", keys=["ArrowDown"], expect=CARD),
    dict(name="04-home-rail-4", keys=["ArrowDown"] * 3, expect=CARD),
    dict(name="05-home-rail-last", keys=["ArrowDown"] * 8, expect=CARD),
    # --- tabs (F7 = R shoulder) ---
    dict(name="06-tab-series", keys=["F7"], expect=CARD),
    dict(name="07-tab-live", keys=["F7", "F7"], expect="#rails"),
    dict(name="08-tab-youtube", keys=["F7", "F7", "F7"], expect="#rails"),
    # --- browse bar controls ---
    dict(name="09-search-entry-focused", keys=["ArrowUp"], expect="#search-entry"),
    dict(name="10-shuffle-focused", keys=["ArrowUp", "ArrowRight", "ArrowRight", "ArrowRight"],
         expect="#library-refresh"),
    # --- search ---
    dict(name="11-search-empty", click="#search-entry", expect="#search-view:not(.hidden)"),
    dict(name="12-search-typing", click="#search-entry", keys=["Enter", "Enter", "Enter"],
         expect="#search-view:not(.hidden)"),
    # --- detail ---
    dict(name="13-detail-movie", click=CARD, expect=DETAIL),
    dict(name="14-detail-actions-focus", click=CARD, keys=["ArrowRight"], expect=DETAIL),
    dict(name="15-detail-streams-focus", click=CARD, keys=["ArrowDown", "ArrowDown"], expect=DETAIL),
    dict(name="16-detail-series", tab_keys=["F7"], click=CARD, expect=DETAIL),
    dict(name="17-detail-series-episodes", tab_keys=["F7"], click=CARD,
         keys=["ArrowDown", "ArrowDown"], expect=DETAIL),
    # --- settings (reached by view toggle: no home affordance) ---
    dict(name="18-settings", force="settings", expect="#settings-view:not(.hidden)", synthetic=True),
    # --- states only reachable by controlling the backend ---
    dict(name="19-rails-loading", control=dict(delay_ms=6000), expect="#rails", no_settle=True),
    # No cards will ever render in these two, so they cannot use the default
    # "app is ready" probe.
    dict(name="20-rails-empty", control=dict(empty=["rails"]), ready="#rails", expect="#rails"),
    dict(name="21-rails-failed", control=dict(fail=["rails"], status=503), ready="#app",
         expect="#app"),
    dict(name="22-detail-streams-failed", control=dict(fail=["stream"], status=503),
         click=CARD, expect=DETAIL),
    dict(name="23-play-failure-toast", click=CARD, keys=["Enter"], expect=DETAIL,
         wait_for='#toast[data-visible="true"]'),
    # --- event-driven overlays: forced, clearly labelled synthetic ---
    dict(name="24-voice-hud-listening", force="voice", expect='#voice-hud[data-visible="true"]',
         synthetic=True),
    dict(name="25-next-episode-prompt", force="next", expect="#next-episode-prompt:not(.hidden)",
         synthetic=True),
    dict(name="26-toast-alone", force="toast", expect='#toast[data-visible="true"]', synthetic=True),
]

FORCE_JS = {
    "settings": """() => {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById('settings-view').classList.remove('hidden');
    }""",
    "voice": """() => {
        const h = document.getElementById('voice-hud');
        h.dataset.visible = 'true'; h.dataset.state = 'listening';
        h.setAttribute('aria-hidden', 'false');
        document.getElementById('voice-state').textContent = 'listening';
        const u = document.getElementById('voice-user-line');
        u.hidden = false;
        document.getElementById('voice-user-text').textContent = 'something funny from the nineties';
    }""",
    "next": """() => {
        const p = document.getElementById('next-episode-prompt');
        p.classList.remove('hidden'); p.setAttribute('aria-hidden', 'false');
    }""",
    "toast": """() => {
        const t = document.getElementById('toast');
        t.dataset.visible = 'true'; t.setAttribute('aria-hidden', 'false');
        t.textContent = "couldn't start that stream — try again";
    }""",
}


def write_control(cfg: dict) -> None:
    CONTROL.parent.mkdir(parents=True, exist_ok=True)
    CONTROL.write_text(json.dumps(cfg))


def run_scene(page, scene: dict) -> tuple[str, str | None]:
    write_control(scene.get("control", {}))
    page.goto(URL, wait_until="domcontentloaded")

    if scene.get("no_settle"):
        # Capture mid-flight: do not wait for content, that is the point.
        page.wait_for_timeout(400)
    else:
        # Wait for the app to be usable before acting; the scene's own
        # expectation is only checked after the navigation it describes.
        try:
            page.wait_for_selector(scene.get("ready", CARD), timeout=15000)
        except PWError:
            return "SKIP", f"app never became ready ({scene.get('ready', CARD)})"
        page.wait_for_timeout(SETTLE_MS)

    for key in scene.get("tab_keys", []):
        page.keyboard.press(key)
        page.wait_for_timeout(SETTLE_MS)

    if selector := scene.get("click"):
        try:
            page.locator(selector).first.click(timeout=6000)
            page.wait_for_timeout(SETTLE_MS)
        except PWError:
            return "SKIP", f"could not activate {selector}"

    for key in scene.get("keys", []):
        page.keyboard.press(key)
        page.wait_for_timeout(260)

    if force := scene.get("force"):
        page.evaluate(FORCE_JS[force])
        page.wait_for_timeout(300)

    if waiter := scene.get("wait_for"):
        try:
            page.wait_for_selector(waiter, timeout=8000)
        except PWError:
            return "SKIP", f"never reached {waiter}"

    if not scene.get("no_settle"):
        try:
            page.wait_for_selector(scene["expect"], timeout=10000)
        except PWError:
            return "SKIP", f"expectation never appeared: {scene['expect']}"

    page.wait_for_timeout(200)
    path = OUT / f"{scene['name']}.png"
    page.screenshot(path=str(path))
    return "OK", None


def main() -> int:
    wanted = sys.argv[1:]
    scenes = [s for s in SCENES if not wanted or any(w in s["name"] for w in wanted)]
    OUT.mkdir(parents=True, exist_ok=True)
    results, seen = [], {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page.on("pageerror", lambda e: print(f"  [page error] {str(e)[:120]}"))
        for scene in scenes:
            status, note = run_scene(page, scene)
            digest = None
            if status == "OK":
                path = OUT / f"{scene['name']}.png"
                digest = hashlib.md5(path.read_bytes()).hexdigest()[:10]
                if digest in seen:
                    status, note = "DUPLICATE", f"identical to {seen[digest]}"
                else:
                    seen[digest] = scene["name"]
            results.append(dict(name=scene["name"], status=status, note=note, md5=digest,
                                synthetic=bool(scene.get("synthetic"))))
            flag = " (synthetic)" if scene.get("synthetic") else ""
            print(f"  {status:9} {scene['name']}{flag}" + (f" — {note}" if note else ""))
        browser.close()

    write_control({})
    (OUT / "manifest.json").write_text(json.dumps(results, indent=2))
    rows = "\n".join(
        f'<figure><img src="{r["name"]}.png" loading="lazy"><figcaption>{r["name"]}'
        f'{" · synthetic" if r["synthetic"] else ""} · {r["status"]}</figcaption></figure>'
        for r in results if r["status"] == "OK"
    )
    (OUT / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>mango UX capture</title>"
        "<style>body{background:#111;color:#eee;font:14px/1.4 system-ui;margin:24px}"
        "figure{margin:0 0 28px}img{width:100%;max-width:1280px;display:block;border:1px solid #333}"
        "figcaption{padding:6px 0;color:#aaa}</style>" + rows
    )
    ok = sum(1 for r in results if r["status"] == "OK")
    print(f"\n{ok}/{len(results)} captured -> {OUT}")
    print(f"contact sheet: {OUT / 'index.html'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
