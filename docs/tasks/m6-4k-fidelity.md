# M6.3 — 4K fidelity ceiling on Pi 5

> Research round 2026-07-29 (`$mango-tv-box-expert`). Question: what is the
> highest-fidelity 4K playback the Pi 5 can deliver, and what is the easiest
> principled way for mango to reach it? Includes the hardware-replacement angle.
>
> Companion: [`docs/PLAYABILITY.md`](../PLAYABILITY.md) · [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) · [`docs/HARDWARE.md`](../HARDWARE.md)

## Measured on the box — 2026-07-29

All numbers from the live Pi (`mango`, Pi 5 8 GB, Pi OS trixie, mpv 0.40.0,
Samsung `QBQ90S`).

**Read the metric warning first.** Two metrics were used and only one is
trustworthy. Early runs measured the *change in mpv's `avsync` property* and
derived "% of realtime" from it; that reading sits at a perfect 100% when the
player is stalled, because `avsync` does not move when nothing plays. Later runs
measure **`time-pos` advance against wall clock** plus `frame-drop-count`, which
cannot be fooled that way. Every `avsync`-derived figure below is retained only
as a record of a wrong turn — **do not cite it.**

**A third rule, learned the hard way (see §3b): pipeline metrics cannot prove
anything appeared on screen.** `time-pos` advancing with `frame-drop-count` at
zero is exactly what a renderer that draws *nothing* reports — no frames reach
the VO, so none can be dropped. Every playback measurement must carry visual
proof: `scrot -o /tmp/x.png` under X11 (it does capture mpv's window), then check
the PNG size. A real 4K frame is megabytes; a flat fill is ~30 KB. On the DRM
console `scrot` cannot help, so a human must confirm the picture.

Fixtures also matter: synthetic high-entropy noise at 93–99 Mbps
(`~/mango-4k-fixtures/`) defeats compression and the render pipeline in ways real
film does not, and it made the shipped path look broken when it is not.

### 1. The HDMI link was the ceiling — fixed for free

The TV input was negotiating **HDMI 1.4**: max TMDS 340 MHz, no HDMI Forum VSDB,
best 4K mode **3840x2160@30**, and a YCbCr 4:2:0 Video Data Block (the Pi cannot
emit 4:2:0). `display-mode.log` shows mango repeatedly trying and failing:
`playback: rate unavailable … mode=3840x2160@60 … gave up`.

Enabling **Input Signal Plus** on that input (Samsung; "HDMI UHD Color" on
consumer sets) moved the port to HDMI 2.0: **600 MHz**, `3840x2160@60` now
preferred, `DC_30bit`/`DC_36bit`/`DC_Y444` deep colour, HDR10 + HLG + BT.2020.
`max bpc` accepted at 10 and a 4K60 modeset held. **This is a required setup
step, not an optimisation — without it 4K60 does not exist on this box.**

### 2. On real content, mango's shipped 4K path is already good

Trustworthy A/B, identical scene, same wall-clock window, production args
(`vo=gpu`, `video-sync=audio`, launcher frozen, mode-matched). Subject is the
stream mango's own ladder picked for **Dune (2021)** at `4k_sdr_remux_cached`:
TorBox-cached BluRay remux, 66.2 GB, HEVC Main 10, 3840x1606, 23.976 fps,
~51 Mbps sustained over the network.

| Path | Result |
|---|---|
| **X11 `vo=gpu` (shipped today)** | **1 dropped frame in 30 s (0.1%)**, 100% of realtime, av-sync ≤0.0002 s, `hwdec=drm` zero-copy, mode `3840x2160@23.98`, 93 s cache |
| `vo=drm` + drmprime plane + `xrgb2101010` | **did not play** — `time-pos` advanced 0.0 s in 30 s, fell back to `hwdec=drm-copy`, empty log |

So the premise that 4K is broken does **not** hold for real remuxed film, and the
plane path has not been shown to play at all. Its earlier apparent perfection was
the stalled-player artifact described above.

### 2b. Superseded — synthetic-fixture results (do not cite)

Kept for the record. These used the `avsync` metric and noise fixtures, so they
overstate the deficit on the X11 path and are meaningless for `vo=drm`.

| Path | Fixture | Output mode | Sustains |
|---|---|---|---|
| X11 `vo=gpu` | 4K24 HDR 93 Mbps, tone-mapped | 3840x2160@24 | **63%** of realtime |
| X11 `vo=gpu` | same file, HDR conversion forced **off** | 3840x2160@24 | **77%** |
| X11 `vo=gpu` | 4K60 SDR 99 Mbps | 3840x2160@60 | **78%** |
| X11 `vo=gpu` | same decoded frames | 1920x1080 | **100%**, av-sync 1e-05 |
| **`vo=drm` + drmprime plane + `xrgb2101010`** | 4K24 HDR 93 Mbps | 3840x2160@24 | **100%**, 0 drops |
| **`vo=drm` + drmprime plane** | 4K60 SDR 99 Mbps | 3840x2160@60 | **100%**, 0 drops |
| `vo=gpu` on DRM context (no X) | 4K24 HDR 93 Mbps | 3840x2160@24 | drifts (−1.59 s/6 s) |

Everything else is exonerated: hardware decode alone runs **1.4–1.8× realtime**
on these files (`hwdec-current = drm`; software decode is 0.52×), `/dev/shm`
playback drops **identically** to disk, CPU sits at 2–4%, and freezing the
launcher with no compositor changes nothing. 13 Mbps synthetic 4K clips hit zero
drops at 4K output, so this is not a hard 4K wall — decode plus X11 GL present at
3840×2160 together exceed the frame budget, and only realistic bitrates expose it.

Within that superseded set, tone mapping was the smaller half: forcing the same
4K24 file to be treated as SDR (`--vf=format:gamma=bt.1886:primaries=bt.709`)
recovered only 63% → 77%. Since the real-content A/B shows 0.1% drops on that
same path, treat this as evidence about the fixtures, not about mango.

**Lane 1 is unproven.** Retracted claim: it was never shown to sustain anything,
because it was never shown to play.

### 3b. `vo=gpu-next` is unusable on this GPU — full retraction

An intermediate conclusion claimed that `vo=gpu-next` (libplacebo) tone-mapped 4K
HDR10 for free — zero dropped frames where `vo=gpu` dropped 128–162 — and that
this made both the Kodi lane and the KMS lane unnecessary. **That was wrong.**
`gpu-next` was rendering nothing. The couch report was a flat violet screen; the
screenshot was 29 KB of uniform fill at 3840x2160 while `vo=gpu` produced a
5.2 MB frame of actual film with the OSD label legible.

Root cause, from `--msg-level=all=v`:

```
[vo/gpu-next/libplacebo] Failed creating framebuffer: error code 36061
[vo/gpu-next] Failed rendering frame!
```

`36061` is `GL_FRAMEBUFFER_UNSUPPORTED`. v3d's GLES cannot create the framebuffer
libplacebo needs for **imported DRM PRIME planes**, so every frame fails and the
VO shows its clear colour. It reports zero drops because no frame ever reaches
presentation. Both hwdec workarounds fail on performance instead:

| Renderer + hwdec | Renders? | Realtime | Drops |
|---|---|---|---|
| `vo=gpu` + `hwdec=drm` (**shipped**) | **yes** (5.2 MB frame) | 100% | 162 (4K HDR tone-map cost) |
| `vo=gpu-next` + `hwdec=drm` | **no** (29 KB flat fill) | "100%" — meaningless | "0" — meaningless |
| `vo=gpu-next` + `hwdec=drm-copy` | yes | **67.7%** | 483 |
| `vo=gpu-next` + `hwdec=no` | yes | **45.1%** | 281 |

`gpu-next` does render software-decoded frames correctly — a 1080p H.264 HLS live
channel played fine through mango's own path — which is why the failure is
specific to hardware-decoded (DRM PRIME) frames and was easy to miss.

**Consequences.** The `exclude_hdr` policy above 1080p on the mpv X11 path is
correct and stays. And because mpv's HDR-on-DRM signalling lives in the
libplacebo path (`--target-colorspace-hint` → `vo_drm_set_color`), and libplacebo
cannot render hardware frames here, **mpv cannot deliver HDR on this SoC at all**,
independent of display server. This independently confirms the Raspberry Pi
engineer's 2025-04-28 statement that Kodi is the only HDR-capable player on Pi.
The earlier "mpv 0.40 on DRM played 4K HDR10 smoothly at 100.1% realtime with
zero drops" measurement used `gpu-next` and is **void**.

### 3. Consequences

- `vo=drm` plane path does **no** GPU per-pixel work, so it also cannot
  tone-map — HDR would reach a link never told it is HDR, i.e. washed out.
  **HDR still needs Lane 2**, and this holds regardless of whether Lane 1 works.
- Cooling is adequate: fan 5416 RPM at cooling state 4, clocks held at 2.4 GHz,
  no active throttle bits. Earlier 81 °C readings were caused by the fixture
  encoder, not playback.
- The VT round-trip (`chvt 3` → mpv → `chvt 7`) restored X, Chromium, the
  launcher display, and left no stray processes or markers. Requires `sudo`.

## Lane 2 proven on the box — 2026-07-29

**Kodi's GBM backend delivers real 4K HDR10 to this TV, hardware-decoded, at
exactly realtime.** Same stream mpv drops 27.7% of frames on. Connector state
read from a second session while playing:

| Connector property | X11 desktop (before) | Kodi `--windowing=gbm` (during) |
|---|---|---|
| `max bpc` | **8** | **12** |
| `Colorspace` | `Default` | **`BT2020_YCC`** |
| `HDR_OUTPUT_METADATA` | blob 685 | **blob 688 (rewritten)** |
| Mode / TMDS | 1920x1080@60 | **3840x2160@60, 594 MHz** |

Playback advanced 17 s → 42 s across a 25 s wall-clock window — **exactly
realtime, no stall, no drift.** Kodi log confirms the path:
`CDVDVideoCodecDRMPRIME::Open - using decoder HEVC` (hardware DRM PRIME,
direct-to-plane) and `[display-info] supports hdr static metadata type1: true`.
`videoplayer.allowedhdrformats` is already `0,1` = HDR10 + HLG only, so Dolby
Vision is correctly not attempted.

So the HDR gap is real, closable, and **only** closable this way: mpv cannot
write `HDR_OUTPUT_METADATA` on this SoC, and Kodi's X11 window (what mango uses
today) cannot either — it took `--windowing=gbm` on a spare VT to move the link
into deep colour and BT.2020.

Two defects to fix before shipping it:

- **`videoplayer.adjustrefreshrate = 0`** — refresh matching is disabled, so
  23.976 fps content was output at 60 Hz, i.e. 3:2 judder. Must be `1` or `2`.
- `CDVDVideoCodecDRMPRIME::FilterOpen - avfilter_graph_config` failed twice
  (`-38`, `-22`). Benign for progressive content, but unexplained.
- **Colour state leaks back to the launcher — couch-visible.** Observed live: the
  launcher came back washed out with a red cast, and then read persistently
  brighter than normal. Kodi leaves **three** things set: `Colorspace =
  BT2020_YCC`, `max bpc = 12`, and — corrected below — a **live
  `HDR_OUTPUT_METADATA` blob**. X never resets any of them.

  **Correction (2026-07-29):** an earlier note here claimed Kodi clears the HDR
  blob on shutdown. It does not. That claim came from `kmsprint -p`, which prints
  only `blob-id 688 len 32` and no contents. `drm_info` parses the blob, and hours
  after the Kodi test the connector still carried Kodi's playback metadata:
  `EOTF: SMPTE ST 2084 (PQ)`, BT.2020 primaries, mastering 4000 / 0.005 cd/m²,
  MaxCLL 787, MaxFALL 239. The TV was being told it was receiving HDR10 while X
  sent SDR — the real cause of the "everything looks brighter" report. Use
  `drm_info`, never `kmsprint`, to verify HDR teardown.

  Recovery that worked, in two parts:

  ```bash
  # 1. the two enums X does expose
  xrandr --output HDMI-1 --set Colorspace Default --set "max bpc" 8
  xrandr --output HDMI-1 --off && sleep 4   # force the TV to re-negotiate
  bash scripts/lib/mango-display-mode.sh ensure-launcher

  # 2. the HDR blob, which X cannot touch: needs DRM master released
  sudo chvt 2 && sleep 2
  sudo modetest -M vc4 -w 35:HDR_OUTPUT_METADATA:0   # 35 = HDMI-A-1 connector id
  sudo chvt 7 && sleep 3
  bash scripts/lib/mango-display-mode.sh ensure-launcher
  sudo drm_info | grep -A2 HDR_OUTPUT_METADATA        # must read "blob = 0"
  ```

  The blob survives X restarts and the xrandr off/on cycle, so a stack restart
  does **not** recover it. Requires `drm-info` and `libdrm-tests` (both installed
  on the box 2026-07-29).

  **Lane 2 requirement:** the restore path must reset `Colorspace` and `max bpc`
  explicitly and force an HDMI re-negotiation, then verify all three properties
  before showing the launcher. Add to the acceptance list below.

  After recovery the launcher still read slightly brighter and sharper than
  remembered. Ruled out on the Pi side: the mode is the same CEA 1080p60 timing
  as before the test (`0x24f`, 148.5 MHz), with `Colorspace Default` and
  `max bpc 8`. Quantization range was A/B'd live — forcing `Broadcast RGB Full`
  crushed shadow detail, which confirms the TV expects **limited** range and that
  the shipped `Automatic` is correct. The residual difference is TV-side
  processing (Input Signal Plus is a persistent per-input change, and Samsung
  stores picture settings separately for SDR and HDR, so an HDR excursion can
  leave the input on a different preset). **Do not "fix" this in the repo.**

## Ladder alignment audit — 2026-07-29

Question: which fidelities does mango demote, for what stated reason, and do
those reasons match what the hardware actually does? Live profile is
`m6.5-tv-mpv-4k-sdr-hifi` (`/etc/mango/catalog-filters.json`) with capability
profile `pi5-x11-mpv-hifi`.

### Every fidelity-gating hardware/smoothness claim, checked

| Gate | Stated reason | Measured | Verdict |
|---|---|---|---|
| `exclude_hdr` above 1080p (`play-ladder.ts:360`, both 4K main steps) | X11 cannot output HDR; 4K GPU tone-map stutters | Real Dune 4K **HDR10** remux (3840x1608, 41 Mbps): **200 drops/30 s = 27.7% of frames**, `decoder_drop=0`. SDR twin at *higher* bitrate: **1 drop/30 s** | **Correct** — and the cost is huge (11 of 12 real Dune 4K candidates are HDR) |
| `require_hevc` above 1080p (`play-ladder.ts:349`) | Pi 5 hardware-decodes HEVC only | Software 4K decode ≈**0.52× realtime**; hardware 1.4–1.8× | **Correct** |
| 4K SDR HEVC ranks above 1080p (`playback-capability.ts:168`, `proven_smooth`) | within proven envelope | 0.1% drops on a 66 GB remux, mode-matched `3840x2160@23.98` | **Correct**, now empirically backed |
| HDR admitted **at** 1080p | 1080p tone-maps cheaply | 1080p tone-map sustains 100% | **Correct** |
| `validateMainLadderPiPolicy` (`stream-filters.ts:1337`) | main 4K must be HW-decodable HEVC | matches the two above | **Correct** |

**Conclusion: the ladder is honest.** Every gate that costs fidelity is
justified by measured hardware behaviour. The 4K gap is not over-caution, and
**loosening policy cannot close it** — only an HDR-capable renderer can.

### Misalignments found

1. **`last_resort_ladder` is never policy-validated.** `validateMainLadderPiPolicy`
   only inspects `main_ladder` (`stream-filters.ts:1337`), so
   `4k_sdr_soft_cached` (`require_hevc: false`) can admit software-decoded 4K at
   ~0.5× realtime, and the final `last_resort` step admits 2160p with any codec
   *and* HDR — i.e. it can serve exactly the 27.7%-drop case. An obligation floor
   should still refuse streams that provably cannot play in realtime.
2. **Engine-profile footgun.** `set-playback-engine.sh` pairs profile `mpv` with
   `MANGO_CATALOG_FILTERS=4k-hdr` (line 137) and only `mpv-hifi` with `4k-hifi`
   (line 195) — and `catalog-filters.4k-hdr.example.json` has **no**
   `exclude_hdr`. Selecting the plainer engine silently re-admits 4K HDR. The
   live box is on `mpv-hifi`, so this is latent, not active.
3. **1440p is last-resort-only.** `effectiveStreamQualityRank` returns 1440
   (`stream-filters.ts:916`), which exceeds every `max_quality: 1080p` step and
   misses every `min_quality: 2160p` step, so 1440p HEVC — trivially decodable
   here and better than 1080p — reaches only `4k_sdr_soft_cached`/`last_resort`.
4. **`remuxFitsPath` caps are unmeasured** (`playback-capability.ts:197`):
   100 Mbps and 30 fps, defaulting a faster remux to `unknown` and demoting it.
   51 Mbps is proven fine; nothing between 51 and 100+ Mbps has been tested.
5. **Output is 8-bit.** X root depth 24 and `max bpc` = 8, while the link now
   advertises 8–12 after Input Signal Plus. Nothing in the repo ever sets
   `max bpc` or a 10-bit framebuffer, so 10-bit HEVC is truncated at output.
6. **Probe pool and play disagree on hwdec**: `mpv-probe-pool.sh` uses
   `drm-copy`, play uses `auto-safe`.

### Fixed 2026-07-29 (misalignment 2)

The engine-profile footgun was worse than described above: `ensure_filters`
reuses an existing user copy rather than refreshing it from the repo example,
and the Pi's `~/.config/mango/catalog-filters.4k-hdr.json` predated the HEVC
policy — its 4K step had neither `require_hevc` nor `exclude_hdr`. Selecting
engine `mpv` would therefore have loaded a config that `validateMainLadderPiPolicy`
rejects, and the catalog service would have refused to start. Three changes
close it:

- `set-playback-engine.sh` points **both** mpv profiles at `4k-hifi`. Both render
  under X11, so both need the ladder that excludes HDR above 1080p.
- `validateMainLadderPiPolicy` now also requires `exclude_hdr: true` on any 4K
  main step when the capability profile is an `x11` one, so the pairing is
  refused at config load instead of silently stuttering. Non-X11 profiles (the
  future Kodi/KMS lane) are unaffected — this is what lets Lane 2 admit HDR.
- `catalog-filters.4k-hdr.example.json` gains `exclude_hdr` on its 4K step, and
  its notes drop the stale "single VLC backend" framing (no VLC backend exists
  in the repo any more).

The stale user copy was deleted on the Pi; it regenerates from the corrected
example. Verified: 702/702 catalog tests, 5/5 policy tests, and both live
configs (`/etc/mango/catalog-filters.json`, `catalog-filters.4k-hifi.json`)
already satisfy the new rule, so the running box was never at risk.

### Still open — product decisions, not defects

Misalignments 1, 3, 4 and 5 all change what mango admits or how it drives the
display, so they are deliberately left alone pending a decision:

- **Obligation floor (1).** Refusing software 4K would be honest — 0.52×
  realtime is not playback — but it means showing nothing where mango currently
  shows a stuttering attempt. Capability classification already ranks these
  last, so the exposure is narrow.
- **1440p (3).** Admitting it into the main ladder needs a `1440p` member on
  `QualityCap`, which today has only 480p/720p/1080p/2160p.
- **Remux caps (4).** Needs measurement between 51 and 100+ Mbps before moving.
- **10-bit output (5).** Requires X depth 30, which risks the Chromium launcher.
  Better solved by the Lane 2 KMS path than by reconfiguring X.

## Verdict

The Pi 5 hardware ceiling is **4K HEVC 8/10-bit, hardware-decoded, output at
native 4K with source-matched refresh, up to 10-bit — plus HDR10/HLG static
metadata, but only from a direct-KMS client.**

**Corrected 2026-07-29 after the real-content A/B:** for **4K SDR HEVC at 24p,
mango is already at that ceiling.** A 66 GB Dune remux plays mode-matched at
`3840x2160@23.98` with zero-copy hardware decode and 0.1% dropped frames on the
shipped X11 `vo=gpu` path. The only proven gap left is **HDR**, plus two
unmeasured items: real 4K60 content, and whether the catalog policy is demoting
4K that the render path can in fact handle.

Facts 1 and 2 below stand on upstream documentation and still decide the HDR
plan. Fact 3 is **hypothesis only** — the plane path has not been observed to
play on this box.

1. **X11 can never carry HDR.** X.org has no plans to support HDR; on Linux, HDR
   output requires the Wayland `color-management-v1` protocol plus a Vulkan HDR
   WSI, gamescope, or a KMS client that writes the `HDR_OUTPUT_METADATA`
   connector property itself ([ArchWiki](https://wiki.archlinux.org/title/HDR_video_playback)).
2. **mpv cannot output HDR on this SoC — at all.** `--target-colorspace-hint` is
   `vo=gpu-next` only, and in practice depends on Wayland colour management or a
   Vulkan HDR swapchain ([mpv manual](https://mpv.io/manual/master/), [mpv #15892](https://github.com/mpv-player/mpv/issues/15892)).
   VideoCore VII exposes no HDR Vulkan WSI, and mango's own Pi tests found
   `gpu-next` blue-frames. Switching mango to Wayland would **not** fix this.
3. **mpv can bypass X entirely for SDR 4K, cheaply.** `--vo=drm` puts
   hardware-decoded frames straight on a DRM plane with the OSD on a separate,
   downscaled plane. The mpv manual gives this as *the* recipe for 4K on SoCs:
   `--drm-draw-plane=overlay --drm-drmprime-video-plane=primary --drm-draw-surface-size=1920x1080`,
   with `--drm-format=xrgb2101010` for 10-bit output.

So **smoothness/bit-depth and HDR are two separate problems with two separate
fixes.** The KB previously bundled them and dismissed both as high-risk. Only
the HDR half is high-risk.

**Closed 2026-07-29 (afternoon).** Fact 2 is now proven on the box rather than
inferred: `gpu-next` fails with `GL_FRAMEBUFFER_UNSUPPORTED` on every
hardware-decoded frame (§3b), so the earlier "blue-frames" note was the whole
story. Fact 3 remains a hypothesis and is now *less* attractive: `--vo=drm` did
not play, and the `gpu-next` variant of the plane path renders nothing, leaving
only `--vo=gpu --gpu-context=drm` — which renders but cannot signal HDR. The
smoothness half needs no fix (4K SDR is at the ceiling); the HDR half is
Kodi-only and **parked** as priced in Lane 2.

## Hardware ceiling (verified)

| Capability | Pi 5 reality | Source |
|---|---|---|
| HEVC decode | **4Kp60 hardware**, 8-bit and 10-bit | [BCM2712 docs](https://github.com/raspberrypi/documentation/blob/develop/documentation/asciidoc/computers/processors/bcm2712.adoc) |
| H.264 / AV1 / VP9 | **Software only** — "Other CODECs run in software" | BCM2712 docs |
| HDMI output | Dual 4Kp60 **with HDR support**; TMDS ≤600 MHz/port | [Pi 5 product brief](https://pip-assets.raspberrypi.com/categories/892-raspberry-pi-5/documents/RP-008348-DS-4-raspberry-pi-5-product-brief.pdf) |
| Chroma | RGB, YCbCr 4:4:4, 4:2:2 — **no 4:2:0 output** | [LibreELEC 4K HDR](https://wiki.libreelec.tv/configuration/4k-hdr), [RPi forums (6by9)](https://forums.raspberrypi.com/viewtopic.php?t=360752) |
| Bit depth | 8/10/12-bit as `max bpc` connector prop; 4K60 deep colour needs 4:2:2; 12-bit RGB realistically ≤4K30 | RPi forums (6by9) |
| HDR signalling | vc4 attaches `hdr_output_metadata`, `Colorspace`, `max bpc` (8–12), `Output format`, `Broadcast RGB` | [vc4_hdmi.c](https://github.com/raspberrypi/linux/blob/rpi-5.15.y/drivers/gpu/drm/vc4/vc4_hdmi.c) |
| Dolby Vision / HDR10+ | **Impossible** — dynamic metadata + licensing | KB `hardware_upgrade_path` |

Consequences worth internalising:

- **4K in anything but HEVC is off the table.** This validates `require_hevc`.
- **A TV port stuck in a non-enhanced mode silently caps you at 4K30**, because
  the Pi will not offer 4K60 4:2:0. Most 4K film is 23.976/24p, where 4K24 has
  ample TMDS headroom for 10/12-bit — so this mostly bites 50/60 fps content.
- **CMA is a Pi 4 myth.** Pi 5's V3D has an IOMMU and addresses all RAM;
  `cma-512` is not needed and can starve normal memory
  ([RPi forums](https://forums.raspberrypi.com/viewtopic.php?t=384789)). Do not add it.

## Where mango is today

| Layer | Current | Fidelity cost |
|---|---|---|
| Output | X11 + `xrandr`, launcher pinned 1080p60, playback mode-matched | No HDR ever; 8-bit framebuffer |
| Render | `vo=gpu`, `--gpu-api=opengl --opengl-es=yes`, `--profile=fast` | GPU-bound at 4K; `fast` already sets `hdr-compute-peak=no` |
| HDR content | `exclude_hdr` above 1080p; `mpv-hifi` tone-maps `bt.2390` | 4K HDR titles are demoted to 1080p, or drop frames if forced |
| Measured | 3840×2160p25 HEVC Main10 HDR: hardware decode, no throttling, **128 dropped frames / 12.24 s** during GPU tone mapping; 1080p SDR sibling dropped zero | Root cause is the X11 GL tone-map/present path, not decode |
| Kodi | Runs as an **X11 window** (`hide-media.sh` uses `xdotool --class Kodi`); no `chvt` anywhere in the repo | The HDR-capable GBM path is unused |

## The three lanes

### Lane 1 — KMS playback lane (mpv, no new hardware) · **unproven; deprioritised 2026-07-29**

> Status: the plane path did not play in the real-content A/B (`time-pos` frozen,
> `hwdec=drm-copy` fallback). Since the shipped path already handles 4K24 SDR
> remux at 0.1% drops, this lane now needs a *reason* before it needs a sprint —
> the only candidate reason is real 4K60 content, which is unmeasured.
>
> **Update 2026-07-29 (afternoon): this lane cannot deliver HDR either.** The flag
> set below specifies `--vo=gpu-next`, and §3b proves libplacebo cannot render
> hardware-decoded frames on v3d at all. Since mpv's DRM HDR signalling only
> exists in that same libplacebo path, no mpv configuration on this SoC both
> renders and signals HDR. The one configuration never validly tested is
> `--vo=gpu --gpu-context=drm` (renders, but no HDR); it could only reduce the 4K
> HDR tone-map penalty by removing X compositing. Not worth a sprint on its own.

New engine profile `mpv-kms` in `set-playback-engine.sh`: for **4K HEVC SDR**,
run mpv on a dedicated VT with its own modeset instead of inside X.

```
--vo=drm --drm-connector=<HDMI-A-1> --drm-mode=<matched>
--drm-format=xrgb2101010
--drm-draw-plane=overlay --drm-drmprime-video-plane=primary
--drm-draw-surface-size=1920x1080
--hwdec=auto-safe
```

- **Gains:** removes Chromium/X/compositing from the video path entirely; video
  never touches the 3D core; 10-bit output; mpv owns its own mode so the xrandr
  source-match dance disappears for playback.
- **Fits existing design:** mango already freezes Chromium and does a GL reset
  after ≥3 K playback. `hide → black → HDMI match → GPU VO → raise` becomes
  `hide → chvt → mpv modeset → play → chvt back → GL reset`.
- **Unaffected:** pad input (evdev, not X), ALSA audio, mpv IPC, Streams picker,
  ladder/probe logic. HUD/libass moves to the downscaled draw plane.
- **Costs / risks:** VT switch + DRM-master handover is new machinery (Kodi's own
  `kodi` wrapper script is the reference implementation — it `chvt`s away from
  the desktop because DRM allows only one master); restore path must be
  bulletproof or the couch sees a bare console. Keep X11 `vo=gpu` as default and
  fallback until proof lands.
- **Does not deliver HDR.**

### Lane 2 — Kodi-GBM as an HDR renderer (only path to HDR on Pi)

Raspberry Pi OS's `kodi` package is GBM-based, compiled with
`HAVE_HDR_OUTPUT_METADATA`, and supports **DRM PRIME + "Direct to Plane"**; its
launcher script `chvt`s off the desktop ([Kodi forum](https://forum.kodi.tv/showthread.php?tid=371866),
[RPi forums](https://forums.raspberrypi.com/viewtopic.php?t=323303)). Mango keeps
resolve/rank/progress/launcher-return and hands only the resolved URL to Kodi
over JSON-RPC for HEVC **HDR10/HLG** titles, with HDR10 fallback (never DV-only).

Confirmed 2026-07-29: the HDR proof **was** the GBM path (`--windowing=gbm` on a
spare VT via `chvt`), not X11. Kodi 21.3 (`3:21.3+dfsg-1+rpt2`) ships one binary,
`/usr/lib/aarch64-linux-gnu/kodi/kodi.bin`, carrying the `HDR_OUTPUT_METADATA`
symbol and libdisplay-info's CTA HDR parser.

#### Priced honestly — 2026-07-29

Since §3b removed every mpv alternative, this is the *only* HDR path. It is also
expensive, and the price is now characterised rather than guessed:

| Cost | Detail |
|---|---|
| **The HUD cannot move** | `scripts/m2-catalog/service/mango-hud.lua` is an 18 KB mpv Lua script (`require("mp")`) drawing ASS **inside mpv's process**. Kodi owns DRM/GBM exclusively, so no external client can composite over it. Only route is rewriting it as a Kodi Python addon (`xbmcgui.WindowXMLDialog`) driven over JSON-RPC — and it is **unconfirmed** whether an addon overlay knocks Kodi off DRM PRIME direct-to-plane, which is the very thing that makes HDR smooth. |
| **Streams picker likewise** | Same Lua file. Mid-play switching itself is fine (`Player.Open` with a new URL); the UI is a rewrite. |
| **No deferred handoff** | Kodi has no null-VO buffering primitive, so the "first visible frame is already on the matched mode" guarantee needs a different design. |
| **No frame telemetry** | `frame-drop-count` and friends are not exposed over JSON-RPC — only `kodi.log` scraping. The evidence ladder loses the exact signal this whole investigation depended on. |
| **Health model inverts** | `reliability/model.ts:98` reports `fallback Kodi running` as a stack problem; `gate-common.sh:204` fails the gate when Kodi runs at idle; `mango-refresh.sh:25` kills it; the watchdog recognises playback only via `playback-active`/`pgrep mpv`, so it can restart the launcher under an invisible Kodi. All must change. |
| **Residency unproven** | No evidence Kodi can sit resident on an inactive VT without DRM master and resume quickly. Realistically a cold start per HDR title. |
| **Teardown is ours to own** | Kodi leaves live HDR10 metadata on the connector; X cannot clear it (see the correction above). |
| **Security** | The box's Kodi web server is enabled with `services.webserverusername=mango` / password stored in cleartext in `guisettings.xml` — and it is the sudo password — with `esallinterfaces=true`. Must become a generated per-box secret bound to localhost. |

Cheap parts, for whenever this is picked up: input is already isolated because
`mango-tv-pad.py:1164` takes an exclusive `EVIOCGRAB`, so a backgrounded Kodi sees
no pad events and everything must flow through our router; and a working JSON-RPC
client already existed as `scripts/m1-foundation/pad/lib/kodi-rpc.sh`, removed in
`56aef2c`, recoverable from history.

**Decision 2026-07-29: parked, not scheduled.** HDR is a colour-fidelity gain on a
subset of titles. 4K SDR already runs at the hardware ceiling, 4K HDR titles still
play (demoted to 1080p by `exclude_hdr`), and the price above is a rewrite of the
two most couch-visible pieces of mango plus an inversion of its health model.
Revisit only if HDR becomes a stated product requirement.

### Lane 3 — hardware, ranked honestly

| Move | Cost | Fidelity gain | Verdict |
|---|---|---|---|
| TV port → Enhanced/Deep Colour; certified HDMI 2.0+ cable; official 27 W PSU; active cooler | ~$0–40 | Unlocks 4K60 4:2:2 that is otherwise **unavailable**; prevents throttle/brownout | **Do this first** — hygiene, not upgrade |
| More RAM, NVMe, overclock, CM5, Pi 500 | $$ | **None** for playback | Skip |
| Intel N100/N150 mini PC | ~$150–250 | Hardware HEVC **+ H.264/AV1/VP9**; Wayland HDR path maturing; keeps the entire mango repo (Debian/systemd/Docker/Chromium/Node/mpv) | Best one-box replacement if 4K H.264/AV1 matters; still no DV/HDR10+ |
| Licensed appliance (Dune Pro One 8K Plus, Ugoos AM6B+/CoreELEC) as delegated renderer | $200–400 + 1–6 weeks | Only route to **DV / HDR10+ / TrueHD bitstream** | Defer unless DV is a hard requirement |

## Sequencing (easiest first, each independently valuable)

| Step | Where | Work | Unlocks |
|---|---|---|---|
| ~~0. Measure the envelope~~ | Pi | **done 2026-07-29** | See "Measured on the box" |
| ~~0b. Enable Input Signal Plus~~ | TV | **done 2026-07-29** | 4K60 + 10/12-bit deep colour |
| ~~0d. Audit why the catalog demotes 4K~~ | catalog-service | **done 2026-07-29** | Ladder is honest; only HDR is demoted |
| ~~0e. Prove Kodi GBM HDR~~ | Pi | **done 2026-07-29** | 4K HDR10, 12-bit, BT.2020, realtime |
| ~~0f. Test whether mpv can render/signal HDR~~ | Pi | **done 2026-07-29** | No: `gpu-next` cannot render hardware frames (§3b) |
| ~~0g. Engine/filter pairing fix~~ | catalog-service | **done 2026-07-29** (`3c19353`) | Both mpv profiles on `4k-hifi`; X11 4K requires `exclude_hdr` |
| 1. Remaining ladder misalignments | catalog-service | small | Last-resort validation, 1440p (`QualityCap`), remux caps — **product decisions, see above** |
| 2. Lane 2 (Kodi HDR) | Mac → Pi | ≫1 sprint | HDR10/HLG titles — **parked**, priced in Lane 2 |
| 3. Lane 1 (`mpv-kms`, `vo=gpu` only) | Mac → Pi | ~1 sprint | Unproven; no HDR; only if real 4K60 ever matters |
| 4. Lane 3 appliance | hardware | weeks | DV/HDR10+/HD audio |

**Nothing on this list is currently scheduled.** 4K SDR is at the hardware
ceiling, the engine/filter footgun is fixed and shipped, and the only remaining
fidelity gain (HDR) is parked on cost.

### Step 0 — Pi measurement checklist (completed 2026-07-29; keep for re-validation)

```bash
# 1. What the TV actually accepts (4K60 present? 4:2:0-only?)
modetest -c | sed -n '1,120p'          # or kmsprint
sudo edid-decode < /sys/class/drm/card*-HDMI-A-1/edid | grep -iE '420|4:2:0|deep|YCbCr'

# 2. Connector properties we are not using
modetest -c | grep -iE 'max bpc|Output format|Broadcast RGB|Colorspace|HDR_OUTPUT_METADATA'

# 3. What mpv really does on a 4K play (during playback)
bash scripts/diag/playback-4k-proof.sh --watch
bash scripts/diag/playback-smoothness-probe.sh        # hwdec-current, drops/s, temp, throttle

# 4. Is Kodi GBM or X11 here?
file "$(command -v kodi)"; grep -n chvt "$(command -v kodi)" 2>/dev/null
grep -iE 'gbm|x11|windowing' ~/.kodi/temp/kodi.log | head
```

Record: available 4K modes and refresh rates, whether 4K60 appears at all,
current `max bpc`, `hwdec-current` on a real 4K play, drops/s, SoC temp and
`get_throttled`, and Kodi's windowing backend. **Do not add `cma-512`.**

## Couch acceptance — 4K fidelity

### Must never happen

- [ ] Launcher returns washed out or colour-tinted because `Colorspace` / `max bpc` / HDR metadata were left set by the HDR renderer
- [ ] Bare console or wallpaper visible during or after a VT-switched play
- [ ] Playback starts before the display is source-matched (4K decode on a 1080p panel)
- [ ] A 4K HDR title silently plays a dropping stream instead of a smooth 1080p one
- [ ] Launcher returns without GPU/EGL recovery after a ≥3 K mode

### Pass / fail

| # | Test | Evidence | Pass |
|---|---|---|---|
| 1 | 4K SDR HEVC, 90 s | `playback-4k-proof.sh` PASS, drops/s ≈ 0, `hwdec-current` ≠ `no` | |
| 2 | 10-bit output active | `max bpc` ≥ 10 during play; no banding on a gradient fixture | |
| 3 | 24p source matching | HDMI mode reports 24/23.98 Hz; no judder over 60 s | |
| 4 | Y-back → launcher | Launcher visible <300 ms after VT restore, focus on Play | |
| 5 | Repeat 3× | No leaked mpv, no stuck VT, no GL corruption in Chromium | |
| 6 | Lane 2 only | HDR title shows TV HDR badge; Y-back still returns to launcher | |

## What not to do

- Do **not** switch mango to Wayland expecting HDR — v3d has no HDR Vulkan WSI.
- Do **not** retry `vo=gpu-next` for HDR on this SoC before Lane 1 lands; the
  blue-frame failure is known and it buys nothing for SDR 4K.
- Do **not** add `cma-512` (Pi 4 advice; harmful on Pi 5).
- Do **not** loosen `require_hevc` above 1080p; software 4K has no smooth path.
- Do **not** treat nominal 4K as smooth 4K without `playback-4k-proof.sh`.
