#!/usr/bin/env python3
"""Check that the launcher's edge fades are driven by scroll position.

Reads the computed opacity of the two scrim pseudo-elements at rest, mid-scroll,
and at the end of the scrollport, plus the per-card cascade delays that
sibling-index() resolves to. Exists because these are the two claims in the
polish round that a screenshot cannot prove: a gradient at opacity 0 and a
gradient at opacity 1 look identical in a still if the content behind it is dark.

  python3 tools/ux-harness/probe-scroll-edges.py
"""

from __future__ import annotations

import json

from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"

PROBE_JS = """
async () => {
  const rails = document.querySelector('.rails');
  const bar = document.querySelector('.browse-bar');
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const opacity = (el, pseudo) =>
    Number(getComputedStyle(el, pseudo).opacity).toFixed(3);
  const sample = async (top) => {
    rails.scrollTop = top;
    await frame();
    return {
      scrollTop: Math.round(rails.scrollTop),
      topFade: opacity(bar, '::after'),
      bottomFade: opacity(rails, '::after'),
    };
  };

  const max = rails.scrollHeight - rails.clientHeight;
  const samples = {
    rest: await sample(0),
    nudged: await sample(24),
    settled: await sample(200),
    nearEnd: await sample(max - 24),
    end: await sample(max),
  };
  rails.scrollTop = 0;
  await frame();

  // Cascade: what sibling-index() actually resolves to per card in a rail.
  rails.classList.add('rails--shuffled');
  await frame();
  const track = document.querySelector('.rail--catalog .rail-track');
  const delays = [...track.querySelectorAll('.card')].map(
    (card) => getComputedStyle(card).animationDelay,
  );
  const appsDelay = (() => {
    const appCard = document.querySelector('.rail--apps .card');
    return appCard ? getComputedStyle(appCard).animationName : 'no-apps-rail';
  })();
  rails.classList.remove('rails--shuffled');

  return { max: Math.round(max), samples, cascadeDelays: delays, appsRailAnimation: appsDelay };
}
"""


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        # Not networkidle: the launcher holds long-poll requests open for voice
        # and pad-nav, so the network never goes idle.
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_selector(".rail--catalog .card", timeout=15000)
        page.wait_for_timeout(600)
        print(json.dumps(page.evaluate(PROBE_JS), indent=2))
        browser.close()


if __name__ == "__main__":
    main()
