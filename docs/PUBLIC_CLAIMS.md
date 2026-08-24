# Public claims

This register is the wording boundary for the repository, website, GitHub
metadata, release notes, and social assets. Implementation and
[STATUS.md](STATUS.md) are the evidence owners. Marketing copy may shorten a
row; it may not widen it.

## Audiences

| Audience | Job |
|----------|-----|
| Visitor | Understand what Mango is and whether it fits |
| Builder | Install a supported Pi 5 from a clean clone |
| Viewer | Browse, inspect, play, rate, and return |
| Operator | Deploy, configure, and repair without losing state |
| Contributor | Change source with local-pass evidence |
| Maintainer | Record what is proven versus deferred |

## Promise

Mango is a household-owned TV product for Raspberry Pi 5. One person can
browse movies, shows, YouTube, and optional live television on the TV, inspect
a real title, press **B**, and watch in native mpv. Library state stays on the
device.

The long-term product is a living-room appliance. The current release is a
self-hosted **public alpha**: the core viewing loop exists in source and has
been exercised on a development Pi; first-boot, display sleep, native HDR, and
whole-product couch sign-off remain open.

## Approved lines

| Surface | Approved wording |
|---------|------------------|
| Name | `mango` |
| Wordmark | lowercase `mango.` text; no invented logo |
| Hero | reclaim your TV. |
| One-line | a household-owned TV experience on Raspberry Pi 5 |
| Status chip | self-hosted alpha |
| Primary CTA | build mango → [INSTALL.md](INSTALL.md) |
| Secondary CTA | view the source → GitHub `main` |
| Tertiary CTA | contribute / get in touch |
| Player | native mpv; launcher stays visible until advancing media is proven |
| Taste | Fire / Water ratings; **For You** when evidence exists, otherwise labelled **Top Picks** |
| Librarian | optional phone text / push-to-talk that opens Detail; **B** still plays |
| License | Apache-2.0 |

## Must stay visible

- Self-hosted alpha, not a finished retail appliance.
- The household supplies hardware, accounts, addon manifests, credentials, and
  media entitlements.
- Setup is manual and currently expects SSH.
- Native HDR is unsupported on the current X11/mpv path.
- Display sleep and a no-SSH first-boot wizard are not implemented.
- This source release does not claim exact-release Pi or couch proof. Current
  runtime evidence lives only in [STATUS.md](STATUS.md).
- Mango is not affiliated with YouTube, Stremio, debrid services, IPTV
  providers, studios, or broadcasters.

## Forbidden claims

Do not say or imply:

- retail-ready, plug-and-play, ships today, appliance in a box
- bundled movies, shows, IPTV, debrid, or studio entitlements
- native HDR, Dolby Vision output, or a finished 4K living-room picture claim
- voice autoplay, wake-word, or a speaking assistant
- reproduction of YouTube's proprietary Home feed
- `ad-free, without premium` or any YouTube-premium substitution
- `stream anything` / `find anything` as a universal guarantee
- that Reliability Center green, CI green, or an older Pi SHA proves the
  current public tag on a physical TV

## Evidence ownership

| Claim class | Owner | Other surfaces |
|-------------|-------|----------------|
| Current SHA, generation counts, “Pi serves” | [STATUS.md](STATUS.md) only | “see STATUS.md” |
| Product promise and non-goals | [PRODUCT.md](PRODUCT.md) | README, website, release notes |
| How to install | [INSTALL.md](INSTALL.md) | README quick start, website |
| How to watch | [USER_GUIDE.md](USER_GUIDE.md) | website feature list |
| How to operate | [OPERATIONS.md](OPERATIONS.md) | SUPPORT |
| How to change source | [../CONTRIBUTING.md](../CONTRIBUTING.md) | GitHub templates |
| Social / OG images | this file + `marketing/` audit | no binaries in Git |

## Voice and visuals

- Website and social: lowercase, short sentences, real UI nouns
  (Detail, Streams, Fire/Water, Saved, For You, librarian).
- Repository docs: sentence case for scanability; same nouns.
- Canvas `#0B0B12`, UI `#07080A`, text `#F4F1EA`, accent `#E8A020`.
- Show real, privacy-safe product captures. Strip account names, subscription
  counts, credentials, and household identifiers.
- Do not copy Hum or Tir App Store language onto Mango.

## Channel hierarchy

1. What it is and who it is for
2. What works today
3. What you must bring
4. How to build it
5. How to contribute
6. Alpha limits, without letting caveats become the story
