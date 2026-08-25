# YouTube operations

Use the catalog-service CLIs and the existing M6 wrappers. Do not add another
playback resolver.

| Task | Command |
|------|---------|
| Ensure yt-dlp wrapper | `bash scripts/m6-ship/ensure-youtube-yt-dlp.sh` |
| Refresh cache | `bash scripts/m6-ship/youtube-refresh-cache.sh` |
| Smoke | `bash scripts/m6-ship/gate-m6-youtube-smoke.sh` |
| Playback matrix | `MANGO_YOUTUBE_PLAY=1 bash scripts/m6-ship/youtube-playback-matrix.sh` |
| Eval CLI | `cd src/catalog-service && npm run youtube:eval` |

Playback stays 1080p-capped and uses seekable HTTPS DASH first for non-live
VOD; live results are re-resolved with HLS-only policy before playback. See
[docs/features/youtube.md](../../../docs/features/youtube.md).
