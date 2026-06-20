# N5a — Voice tools (phone PTT)

**Input:** phone PTT only · **Playback:** user presses B on remote — voice never auto-plays

## Flow

1. User: *"India's Got Latent dikhao"* / *"open Panchayat"*
2. Agent: `mango_search` → `mango_open_title` (detail page on TV)
3. User presses **B** when ready to play

No `mango_play`, pause, or continue-play tools in voice V1.

## Tool manifest

```http
GET http://127.0.0.1:3020/voice/tools
```

`mango_search`, `mango_open_title`, `mango_navigate`, `mango_now_playing` (read-only), `mango_library_shuffle`, `mango_playability_refresh`.

## Gates

```bash
bash scripts/phase-n5/gate-voice-tools.sh
```

gate-lite runs N5 when `MANGO_VOICE=1`.
