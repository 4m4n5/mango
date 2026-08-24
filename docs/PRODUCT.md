# Product

**Platform:** Raspberry Pi 5 · Raspberry Pi OS Desktop · X11/Openbox · Chromium + mpv
**Current truth:** [STATUS.md](STATUS.md) · **Claims:** [PUBLIC_CLAIMS.md](PUBLIC_CLAIMS.md)

> Browse in Mango. Watch in Mango. Never wonder which app you are in.

Mango is a household-owned 10-foot streaming interface. A person can
browse with a small D-pad controller or ask the phone librarian for
something to watch, inspect a real title, press **B**, and return to the
exact place they left. Playback and library state stay local.

The long-term product is a plug-and-play living-room appliance. The
current system is a self-hosted public alpha: the core viewing loop is
real in source, but display sleep, first-boot setup, native HDR, and
whole-product couch acceptance are unfinished.

## Capabilities

- Search, Movies, TV Shows, optional Live, and YouTube in one D-pad launcher
- Deferred mpv foreground: the launcher stays visible until advancing media is proven
- Cinematic HUD and Streams drawer inside mpv, not a second window
- Mango-owned Continue, Saved, history, Fire/Water ratings, and feedback
- Household VOD rails and provenance-gated YouTube rails, served from cache
- Optional text / PTT phone librarian that opens Detail; **B** still plays
- Reliability Center and conservative repair that never wipes databases

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
| One product | Launcher and mpv are the only supported foregrounds |
| Honest start | Failed probes never replace the launcher with a black screen |
| Local memory | Progress and library state stay on the device |
| Conservative repair | Credentials, history, and caches are not reset as recovery |
| Evidence | Source, local tests, Pi gates, and couch observation stay separate |
