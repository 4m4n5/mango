# UX Round Visual Capture

Generated: 2026-07-30

Local screenshot subset: `/tmp/mango-ux-shots/verified/`

Local API fixtures: `/tmp/mango-ux-fixtures/`

## Fixture Summary

- Captured 50 raw API response JSON fixtures from the Pi, plus `manifest.json` and `MANIFEST.md`.
- UI server was discovered as `http://127.0.0.1:3000`; catalog-service was discovered as `http://127.0.0.1:3020`.
- Internally linked IDs: movie `tt1160419`, series `tt9257258`, episode `tt9257258:1:1`, YouTube video `IJSD9wsTyhE`.
- Core movie, series, episode streams, search, saved/library, settings, reliability, health, and YouTube fixtures are internally consistent. Optional direct rail fallback probes and live meta captured their raw non-200 responses in the fixture manifest.

## Screenshot Manifest

| Filename | Surface | State | Input sequence | MD5 |
|---|---|---|---|---|
| `ux_round_01_home_default.png` | Home | default after reload | `launch-launcher; Ctrl+R` | `f3f1317a1907a488469a2a53cf7f2dc7` |
| `ux_round_03_search_mid_typing.png` | Search | mid-typing query | `type du` | `d816bf1b18a5270ae9e65f09290c1bb3` |
| `ux_round_05_search_results_populated_retry.png` | Search | results populated retry | `Down after submit` | `472b0b2f01e9c6abb20dafa8fb67663a` |
| `ux_round_06_movie_detail_default.png` | Movie detail | default play focus | `Return on first search result` | `1eab149be134ab203d41007c70e2e4a5` |
| `ux_round_08_movie_detail_back_focus.png` | Movie detail | back action focused | `Right from save button` | `0463e9d4c30acfb58c5c51e483649b5b` |
| `ux_round_09_movie_detail_streams_focus.png` | Movie detail | streams panel focused | `Left; Left; Down from actions` | `bb25bc5b5431dfcfd6249a2c98dbe442` |
| `ux_round_12_series_detail_season_chips_focus_retry.png` | Series detail | season/list focus retry | `Down after Right` | `863f516e1aa501cf7a4b68c8e95435da` |
| `ux_round_13_series_detail_episode_list_focus.png` | Series detail | episode list focused | `Down from season chips` | `73c1b276219eb40cf87a02b50a318e33` |
| `ux_round_15_live_tab.png` | Home live tab | live tab selected | `F7; F7 from movies` | `49b1a2fa4092975d18683e90c921dbbe` |
| `ux_round_16_youtube_tab.png` | Home YouTube tab | YouTube tab selected | `F7 from live` | `9c22e593624342394438b92ee4482534` |
| `ux_round_17_settings_default.png` | Settings | settings default | `Down x28; Return` | `8acfa18ab8666f7c69c3897a8615ad59` |
| `ux_round_19_home_final_verified.png` | Home | final home verified | `launch-launcher; Ctrl+R final` | `30a77c4eba457d79e5cc8dce9f48fe63` |

## Reachability Notes

- Deleted same-md5 attempts instead of saving duplicates for: search default, first search-results submit, movie save-button focus, series default, first series season-chip focus, saved rail area, and Reliability Center focus.
- Search default did not produce a distinct frame from the preceding Home capture with the safe key path; the verified Search states are mid-typing and populated results.
- Movie detail default, back focus, and streams-panel focus were captured. Save-button focus did not differ by md5 and was discarded.
- Series detail season/list focus and episode-list focus were captured. A series streams panel was not reachable because the launcher intentionally hides stream lists for series; episodes resolve via play only.
- Live and YouTube browse tabs were captured. The saved rail attempt did not differ by md5 from the prior frame and was discarded.
- Settings was captured. Reliability Center did not produce a distinct md5 after the safe focus move, so it is represented by the settings capture, where Reliability Center is the first settings section.
- Final screenshot returned the launcher to Home; final `pgrep -c mpv` was `0`.
