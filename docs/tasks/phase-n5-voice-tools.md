# N5a — Voice tools (phone PTT)

**Input:** phone PTT only · **TTS:** N7 (HUD text now)

## Architecture

| Layer | Role |
|-------|------|
| **catalog-service** | Media ops: search, play, continue, now-playing, library shuffle/refresh |
| **orchestrator** | Anthropic tool loop, STT, WS hub |
| **launcher** | UI navigate via `launcher_command` WS messages |
| **companion** | PTT + tool activity cards |

## Tool manifest

```http
GET http://127.0.0.1:3020/voice/tools
```

Tier-0: `mango_search`, `mango_play`, `mango_play_continue`, `mango_now_playing`, `mango_library_shuffle`, `mango_playability_refresh`, `mango_navigate`.

Blocking refresh jobs require `confirmed=true` after the user agrees on phone.

## Gates

```bash
bash scripts/phase-n5/gate-voice-tools.sh
bash scripts/phase2/verify-voice-ready.sh   # Pi, MANGO_VOICE=1
```

gate-lite runs N5 when `MANGO_VOICE=1`.

## Manual couch

1. PTT — “Panchayat chalao” / “play Shawshank”.
2. Phone shows tool card (“Starting playback…”).
3. TV HUD shows reply; mpv starts.
4. “kya chal raha hai” — now playing.
5. “series tab kholo” — launcher switches tab.
