#!/usr/bin/env python3
"""Print measured geometry of launcher surfaces at 1920x1080.

Read-only companion to capture.py: instead of screenshots it dumps
getBoundingClientRect numbers so layout claims can be checked against the
rendered box model rather than eyeballed from a PNG.

  python3 tools/ux-harness/measure.py home
  python3 tools/ux-harness/measure.py search
"""

from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
CARD = ".rail-track .card"

HOME_JS = """
() => {
  const vh = window.innerHeight, vw = window.innerWidth;
  const bar = document.querySelector('.browse-bar');
  const tab = document.querySelector('.rails__tab:not([hidden])');
  const rails = [...(tab ? tab.querySelectorAll('.rail') : [])];
  const scroller = document.querySelector('.rails') || document.scrollingElement;
  const r = (el) => { const b = el.getBoundingClientRect();
    return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)}; };
  const barBox = bar ? r(bar) : null;
  const contentTop = barBox ? barBox.y + barBox.h : 0;
  const railInfo = rails.map((el) => {
    const title = el.querySelector('.rail-title');
    const cards = [...el.querySelectorAll('.card')];
    const card = cards[0];
    return {
      label: title ? title.textContent.trim() : '(none)',
      cards: cards.length,
      box: r(el),
      card: card ? r(card) : null,
      titleH: title ? Math.round(title.getBoundingClientRect().height) : 0,
    };
  });
  // How many rails are fully inside the band below the tab bar on first paint.
  const visible = railInfo.filter((i) => i.box.y >= contentTop - 2 && i.box.y + i.box.h <= vh + 2).length;
  const partial = railInfo.filter((i) => i.box.y < vh && i.box.y + i.box.h > contentTop).length;
  return {
    viewport: {vw, vh}, browseBar: barBox, contentTop,
    scrollHeight: scroller ? scroller.scrollHeight : null,
    railCount: railInfo.length, fullyVisible: visible, touchingViewport: partial,
    rails: railInfo,
  };
}
"""

SEARCH_JS = """
() => {
  const vh = window.innerHeight, vw = window.innerWidth;
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const b = el.getBoundingClientRect();
    return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width),
            h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right)}; };
  const keys = [...document.querySelectorAll('.search-key')].slice(0, 1).map((el) => {
    const b = el.getBoundingClientRect();
    return {w: Math.round(b.width), h: Math.round(b.height)}; });
  const starters = [...document.querySelectorAll('.search-starter')].map((el) => {
    const b = el.getBoundingClientRect(); return {h: Math.round(b.height), bottom: Math.round(b.bottom)}; });
  const kb = r('.search-keyboard'), body = r('.search-compose-body'), col = r('.search-starters');
  return {
    viewport: {vw, vh},
    head: r('.search-head'), body, keyboard: kb, column: col,
    keySize: keys[0] || null,
    starterCount: starters.length,
    starterRowH: starters.length ? starters[0].h : null,
    columnLastRowBottom: starters.length ? starters[starters.length - 1].bottom : null,
    // The gap the poster rail would occupy: keyboard bottom to body bottom.
    deadBelowKeyboard: kb && body ? Math.round(body.bottom - kb.bottom) : null,
    deadBelowColumn: col && starters.length
      ? Math.round(col.bottom - starters[starters.length - 1].bottom) : null,
    bodyToViewportBottom: body ? Math.round(vh - body.bottom) : null,
  };
}
"""


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "home"
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector(CARD, timeout=20000)
        page.wait_for_timeout(700)
        if which == "home":
            out = page.evaluate(HOME_JS)
        else:
            page.keyboard.press("Enter")  # search entry
            page.wait_for_selector(".search-key", timeout=20000)
            for ch in sys.argv[2] if len(sys.argv) > 2 else "":
                page.keyboard.press(ch)
                page.wait_for_timeout(120)
            page.wait_for_timeout(1200)
            out = page.evaluate(SEARCH_JS)
        print(json.dumps(out, indent=2))
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
