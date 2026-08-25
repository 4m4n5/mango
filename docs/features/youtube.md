# YouTube

Native YouTube is a first-class Mango tab. Voice may search and open; **B**
still starts playback. Exact Pi generations belong in [STATUS.md](../STATUS.md).

## Architecture

```
Launcher YouTube tab → catalog-service /api/catalog/youtube/*
  youtube.db   rebuildable cache, subscriptions, rail generations
  library.db   Saved, Takeout, local history, Not-for-me
  YouTube Data API   metadata, search, subscriptions
  yt-dlp → mpv      playback, 1080p ceiling, no Data API quota
```

## Recommendation modes

| `MANGO_YOUTUBE_RECS_V2` | Refresh | Public rails |
|-------------------------|---------|--------------|
| `off` | Disabled | History / Saved only |
| `shadow` | Builds latest generation | Recommendation rails hidden |
| `serve` | Builds latest generation | Published Household rails |

VOD and YouTube flags are independent. There is no executable legacy
allocator.

Inputs are OAuth subscriptions plus official Takeout and Mango-local
meaningful watches. Search-history HTML is not imported. The recommender
does not claim to reproduce YouTube Home.

## Playback policy

- Hard 1080p cap (`YOUTUBE_MAX_HEIGHT`)
- HLS-first, then HTTPS DASH
- yt-dlp-maintained player defaults; no Mango-owned client pin
- Explicit supervised loopback PO-token provider; never a LAN listener
- Anonymous public resolve, with cookies only after an account or bot sign-in challenge
- Nightly candidate → live transport canary → atomic active/previous promotion
- Failed candidates never replace the active runtime; resolver failures request
  a low-priority refresh and can use the previous canaried slot once, within
  the original resolve deadline
- Legacy venv and distro binaries are never production fallbacks
- Split A/V must prove AO + aligned audio PTS before the first audible frame
- Cookies and OAuth clients stay in `/etc/mango`

## Operator commands

```bash
bash scripts/m6-ship/ensure-youtube-yt-dlp.sh
bash scripts/m6-ship/youtube-playback-baseline.sh
bash scripts/m6-ship/youtube-refresh-cache.sh
bash scripts/m6-ship/gate-m6-youtube-smoke.sh
systemctl --user status mango-youtube-runtime-refresh.timer mango-youtube-runtime-retry.timer mango-youtube-pot.service
```

The resolver canary is headless and verifies every available sampled
current-rail title plus stable VOD, music, and channel-resolved live-HLS
controls with real audio/video reads. The controls also make first install and
an intentionally empty household valid without weakening transport proof.
Known upstream-fragile classes such as made-for-kids remain
reported advisories instead of permanently freezing safe resolver updates.
The canary never takes the display. Playback matrix with
`MANGO_YOUTUBE_PLAY=1` is Pi-only and still not human picture/audio proof.
