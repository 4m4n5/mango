# User guide

Mango is used from the couch with a D-pad. The phone librarian is optional.
Current limits: [PRODUCT.md](PRODUCT.md). Button codes: [HARDWARE.md](HARDWARE.md).

## The viewing loop

1. Land on Home. One card is focused.
2. Move with the D-pad. **L / R** change tabs.
3. Press **B** on a poster to open Detail.
4. Inspect title, streams, and related titles.
5. Press **B** again to play. The launcher stays up until mpv proves
   advancing media. A failed probe returns you to the same Detail.
6. Press **Y** to go back. **⌂** returns to Home.

If nothing is focused, or a raw URL/ID appears on the TV, that is a bug.
Do not paste those values into issues.

## Tabs

| Tab | What you see |
|-----|----------------|
| Search | Keyboard search across configured catalogs and YouTube |
| Movies | Continue, Saved, For You or Top Picks, category rails |
| TV Shows | Same library and recommendation contract for series |
| YouTube | Household rails from subscriptions, Takeout, and local watches |
| Live | Optional IPTV / Live addons, if you configured them |

**For You** appears only when a personalized generation can be served.
Otherwise Home shows a labelled **Top Picks** rail. That label is
intentional.

## Playback

mpv is the only daily player.

| Control | Action |
|---------|--------|
| **B** | Pause / play |
| **Y** | Back to the launcher |
| **X** | Streams drawer (movies and series); temporary Undo after a switch |
| **− / +** | Volume |
| **← / →** | Seek |
| **↑** | Show HUD, then cycle subtitles |
| **A** | Show HUD, then cycle audio |
| **⌂** | Home |

The HUD never shows signed URLs or filenames. Streams is a five-choice
drawer inside mpv, not a second window. Live and YouTube do not offer
that drawer.

Native HDR is unsupported. Compatible 4K SDR may source-match during
playback; the launcher itself stays 1080p60.

## Library and taste

- **Saved** is Mango-owned and stays on the device.
- **Continue** resumes the exact title or episode.
- **Fire / Water** are the household ratings. Strong Fire helps future
  rails; exact Water below 1 vetoes that title.
- Hide / Not for me / block stay local.

Mango does not write your library back to Stremio.

## Phone librarian

If you enabled the companion, the phone can search and open Detail on
the TV. It does not speak, autoplay, or replace **B**. Pairing and TLS
are operator-owned; see [features/search-and-librarian.md](features/search-and-librarian.md).

## What not to expect

- Bundled movies, IPTV, or debrid
- YouTube Home
- Voice that starts playback
- A finished sleep/wake TV contract
- Pairing mode as ordinary controller recovery — power the pad on
