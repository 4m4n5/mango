# Product

**Platform:** Raspberry Pi 5 · Raspberry Pi OS Desktop · X11/Openbox
**Current truth:** [STATUS.md](STATUS.md) · **Claims:** [PUBLIC_CLAIMS.md](PUBLIC_CLAIMS.md)

> Browse in Mango. Watch in Mango. Never wonder which app you are in.

Mango is one living-room surface. Stream movies, shows, YouTube, and live
television on a Raspberry Pi 5 you own — across sources, in one place.
Inspect a title, watch it at its best, and return to the exact place you
left. Progress, Saved, and taste stay on the device.

The long-term product is a living-room appliance. The current system is a
self-hosted public alpha: the core viewing loop is real in source, but
display sleep, first-boot setup, native HDR, and whole-product couch
acceptance are unfinished.

## Why it exists

Streaming on a television still means leaving one app for another, losing
your place, and teaching a different recommendation system every time.
Mango is the opposite bet: one household-owned surface, local memory, and
a library that learns *this* room.

You bring the Pi, the accounts, and the rights to what you watch. Mango
owns the launcher, search, library, playback chrome, recommendations,
controller routing, and operational proof.

## What you get

- One launcher instead of an app switcher — Search, Movies, TV Shows,
  optional Live, and YouTube
- Inspect, then play: Detail shows quality, audio, and language before
  anything takes the screen
- A library that stays home: Continue, Saved, history, and Fire/Water
  ratings
- Household rails, including YouTube that is not YouTube Home
- An optional phone librarian that opens Detail; playback still starts
  from the couch
- Conservative repair that never wipes credentials, history, or caches

How the pad and player work: [USER_GUIDE.md](USER_GUIDE.md).

## Non-goals

- Automatic fallback to Stremio or Kodi as a daily player
- Reproducing YouTube’s proprietary Home feed
- Bundled debrid, IPTV, or studio entitlements
- Native HDR on the current X11/mpv path
- Wake-word, TTS, or voice autoplay
- A no-SSH first-boot wizard (planned, not implemented)

## Principles

| Principle | Contract |
|-----------|----------|
| One product | The launcher and the daily player are the only supported foregrounds |
| Honest start | Failed probes never replace the launcher with a black screen |
| Local memory | Progress and library state stay on the device |
| Conservative repair | Credentials, history, and caches are not reset as recovery |
| Evidence | Source, local tests, Pi gates, and couch observation stay separate |
