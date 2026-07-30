# UX Round Visual Capture

Generated: 2026-07-30

Local screenshot directory: `/tmp/mango-ux-shots/` (Mac) — pulled from `/tmp/mango-ux-shots/` on the Pi. 37 PNGs at 1920x1080.

This capture combines two passes: a thorough Home-rail traversal + Movie Detail pass (files `01`–`26`, `99`), and a prior same-session pass that captured Search, Series Detail, Live tab, YouTube tab, and Settings (files prefixed `ux_round_*`, which also has its own `ux_round_manifest.json` with MD5s).

## Screenshot Manifest

| Filename | Surface | State | Input sequence reaching it |
|---|---|---|---|
| `01-home-default.png` | Home (Movies tab) | Default/resting state, focus at top-left (search icon), "Continue watching" rail visible | Fresh page reload (`Ctrl+R`) → `F7` to Movies tab → `Up`×10, `Left`×10 to reset to row 0/col 0 |
| `02-home-focus-right.png` | Home (Movies tab) | Focus moved one card right — early exploratory shot, clear focus-ring contrast vs. neighboring cards | `Right` from top-left |
| `02-home-row0-focus.png` | Home (Movies tab) | Chrome row (search/tabs/shuffle) with focus moved right along the tab strip | `Right` from row 0 col 0 |
| `02-home-rail-2.png` | Home (Movies tab) | Rail 1: **Continue watching**, focus entering **Horror** rail below it | `Down` from row 0 |
| `03-home-rail-3.png` | Home (Movies tab) | Horror rail (focus retry — input did not advance this press) | `Down` (no visible change; kept as evidence of an input drop) |
| `04-home-rail-4.png` | Home (Movies tab) | Horror rail (second retry, same state) | `Down` (no visible change) |
| `05-home-rail-5.png` | Home (Movies tab) | **Popular worldwide** rail — "Enemy of the State", landscape cards | `Down` |
| `06-home-rail-6.png` | Home (Movies tab) | **Indian cinema** rail — "Spartacus", "Bhramam" | `Down` |
| `07-home-rail-7.png` | Home (Movies tab) | **Highly rated** rail — "IP Man", "Faraway" | `Down` |
| `08-home-rail-8.png` | Home (Movies tab) | Transitional frame — "Bodies" card visible | `Down` |
| `09-home-rail-9.png` | Home (Movies tab) | **Comedy & comfort** rail — "Being John Malkovich", Nate Bargatze special | `Down` |
| `10-home-rail-10.png` | Home (Movies tab) | **Quick & easy** and **True stories** (documentaries) rails both in view | `Down` |
| `11-home-rail-11.png` | Home (Movies tab) | Same as `10` — confirms bottom of the currently-populated rail stack (documentaries is the last data rail this session) | `Down` (no further change after retries) |
| `12-home-rail-apps-bottom.png` | Home (Movies tab) | Same as `11`, additional `Down` attempts to probe for the Apps/Settings tile row | `Down`×3 (no further change) |
| `13-home-rail-focus-right-1.png` | Home (Movies tab) | Focus moved right within a rail — card focus vs. unfocused neighbors | `Right` |
| `14-home-rail-focus-right-2.png` | Home (Movies tab) | Right retry (input drop, no visible change) | `Right` |
| `15-home-rail-focus-right-3.png` | Home (Movies tab) | Right retry (input drop, no visible change) | `Right` |
| `20-movie-detail-default.png` | Movie detail | Default detail state for **"Killer at the Crime Scene"** (2021 documentary) — poster, title, description, save/library badge, one resolved stream (1080p HDTV H.264, 29GB) | `mousemove`+`click` on a focused documentary card from rail `10`/`11` (keyboard `Return` had stopped registering; mouse click opened the detail page directly, confirmed not the play action — no `mpv` process spawned) |
| `21-movie-detail-save-focus.png` | Movie detail | Focus moved from Play toward the **save** action button | `Right` from default focus |
| `22-movie-detail-notinterested-focus.png` | Movie detail | Focus moved further right along the action-button row | `Right` |
| `23-movie-detail-streams-focus.png` | Movie detail | Focus moved down toward the streams panel | `Down` |
| `24-movie-detail-streams-focus-2.png` | Movie detail | Streams panel, second down step | `Down` |
| `25-back-to-home-from-detail.png` | Movie detail (related titles) | Related-titles row for "Killer at the Crime Scene" ("Inside the World's Toughest Prisons", "Amanda Knox", etc.) — reached mid-attempt to back out; keyboard `Escape` was unresponsive at this point | `Escape` attempts (dropped) + safe mouse click that scrolled into the related-titles row |
| `26-movie-detail-streams-populated.png` | Movie detail | A **second** movie, **"Trainwreck: The Real Project X"** (2025 documentary), opened from the related-titles row — rich streams panel with 5 resolved options (1080p WEB-DL, 1080p WEB-DL, 1080p WEBRip, 1080p WEBRip, 720p WEBRip) each with codec + cached size | Click on a related-title card (no `mpv` spawned — confirmed detail, not play) |
| `99-home-final-state.png` | Home (Movies tab) | Final confirmation state — back at the default top-left resting view, nothing playing | Recovered mouse click found the real Back control → `Up`×10, `Left`×10 to settle at row 0/col 0 |
| `ux_round_01_home_default.png` | Home | Default state after a fresh reload | `launch-launcher; Ctrl+R` |
| `ux_round_03_search_mid_typing.png` | Search | Mid-typing query on the on-screen/physical-keyboard-driven search input | `type du` |
| `ux_round_05_search_results_populated_retry.png` | Search | Results populated ("Top results" grid) | `Down after submit` |
| `ux_round_06_movie_detail_default.png` | Movie/video detail | Detail opened from a search result (a short-form video result, not a rail card) — default play focus | `Return` on first search result |
| `ux_round_08_movie_detail_back_focus.png` | Movie detail | Back action focused | `Right` from save button |
| `ux_round_09_movie_detail_streams_focus.png` | Movie detail | Streams panel focused | `Left; Left; Down` from actions |
| `ux_round_12_series_detail_season_chips_focus_retry.png` | Series detail | **"Conversations with a Killer: The Jeffrey Dahmer Tapes"** — season chips / episode-list focus | `Down` after `Right` |
| `ux_round_13_series_detail_episode_list_focus.png` | Series detail | Episode list focused/scrolled | `Down` from season chips |
| `ux_round_15_live_tab.png` | Home — Live tab | Live tab default state ("World cup" rail with live channel cards) | `F7; F7` from Movies |
| `ux_round_16_youtube_tab.png` | Home — YouTube tab | YouTube tab default state ("For you" rail) | `F7` from Live |
| `ux_round_17_settings_default.png` | Settings | Default Settings view — **Reliability Center is the first section** (status YELLOW, "usable, but reliability needs attention"), followed by pi connection info, Search settings, and Library refresh | `Down`×28; `Return` on the Apps/Settings tile |
| `ux_round_19_home_final_verified.png` | Home | Final home verification from that pass | `launch-launcher; Ctrl+R` (final) |

MD5s for the `ux_round_*` files are recorded in `ux_round_manifest.json` alongside the PNGs.

## Reachability notes

- **Series streams panel — not applicable, by design.** The launcher intentionally hides the stream list for series detail; episodes resolve directly via Play, so there is no separate streams panel to screenshot for series (confirmed by reading `detail.ts` and via direct observation).
- **Search default/empty state — not distinctly captured.** Opening Search from Home did not produce a screenshot that differed from the preceding Home frame under the safe key path tried; only mid-typing and populated-results states are represented.
- **Series detail default state — not distinctly captured** (only season-chips-focus and episode-list-focus survive; an earlier default-focus attempt was pixel-identical to a prior frame and was treated as a dropped keypress).
- **Home "Apps/Settings" rail tile itself** — not captured as an isolated close-up; Settings was reached and its default view (with Reliability Center inline) is captured, satisfying the section-level requirement.
- **Movies rails beyond "documentaries"/"true stories"** — the FocusGrid's last populated row this session appears to be the documentaries rail; further `Down` presses beyond `10`/`11`/`12` produced no visible change, so the Apps/Settings tile row was not distinctly isolated in the fresh Movies-tab pass (it *was* reached transiently via a stray keypress earlier in the session, which is how the Reliability Center content quoted above was first observed, then exited via `Escape`).
- **Input reliability was the dominant operational issue this session.** Synthetic `xdotool key --window <wid>` events to the Chromium kiosk window worked reliably in short bursts (with ~1–2s settle between presses) but repeatedly fell into extended stretches — once for several minutes — where neither keyboard events nor the `/api/pad/nav` HTTP endpoint produced any visible state change, while mouse clicks (`xdotool mousemove` + `click`) continued to register. Recovery was empirical (a mouse click on live content, not any specific key), not deterministic. All movie-detail navigation in the `20`–`26` sequence had to fall back to mouse clicks for this reason. This is worth a follow-up investigation with the real 8BitDo pad to confirm whether couch play is affected the same way, since production input goes through `mango-tv-pad.py`'s own `xdotool key --window` calls — the identical mechanism used here.
- **Backend/frontend catalog cache mismatch observed.** Early in the session the Movies tab's cached `tabCatalogCache` showed only "Continue watching" (and briefly "Saved") as navigable rails, with the other 7 rails present in the DOM but empty ("nothing resolved yet") — even though the catalog-service backend already had fresh, fully-populated data for every rail (verified via `curl localhost:3000/api/catalog/rails/items`). A page reload (`Ctrl+R`) fixed this immediately. Likely cause: the launcher tab fetched its initial catalog before the addons finished warming at boot, and nothing subsequently invalidated the stale cache. Worth flagging for a "revalidate on stale" fix independent of this UX pass.
- **Confirmation:** no video playback was started at any point (`pgrep mpv` returned empty on every check, including the final one), and the launcher was left on Home's default resting view (`99-home-final-state.png`), focus at top-left, "Continue watching" rail visible.
