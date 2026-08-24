# Hardware

Supported host, display, audio, and controller contracts. Product limits:
[PRODUCT.md](PRODUCT.md). Current proof: [STATUS.md](STATUS.md).

## Host and display

| Area | Supported truth | Still open |
|------|-----------------|------------|
| Host | Raspberry Pi 5, 8 GB recommended | Sustained release resource margin |
| OS / session | Raspberry Pi OS Desktop, X11 + Openbox | Wayland |
| Launcher | Chromium kiosk at `1920×1080@60` | Final-TV overscan and readability |
| Playback | Native mpv; 1080p daily; compatible 4K SDR HEVC may source-match | Current-SHA picture / audio matrix |
| HDR | **Unsupported** on the X11/mpv path | Credible HDR engine or an explicit no-HDR ship |
| Audio | HDMI, USB DAC, or Bluetooth | Target TV / soundbar lip-sync |

Do not translate codec capability or an EDID mode into a claim that Mango
is a finished 4K HDR appliance. Browse stays 1080p60. Compatible 4K SDR
is mpv-only and must keep a 1080p fallback.

Optional upgrades when the resource snapshot shows pressure: NVMe SSD,
active cooler, eARC soundbar, USB DAC. Pi 5 has no 3.5 mm jack.

```bash
bash scripts/diag/pi-resource-snapshot.sh
```

## Audio

Pi 5 audio leaves through HDMI unless you add USB or Bluetooth.

```bash
bash scripts/audio/list-sinks.sh
bash scripts/audio/set-default-sink.sh <sink-name>
```

Saved sink: `~/.config/mango/audio.env`. TTS stays off until the TV /
soundbar path is validated.

## Controller

Pair an **8BitDo Micro** in Switch mode (hold START+Y). Linux names it
**Pro Controller**. Set `MANGO_GAMEPAD_BT_MAC`. There is no default MAC
in this repository.

Face buttons, clockwise from the left: **Y · X · A · B**.

| Label | evdev | Action |
|-------|-------|--------|
| **B** | `304` | Select / pause-play |
| **Y** | `308` | Back |
| **X** | `307` | Home shuffle; Search delete/clear; Streams / Undo in VOD playback |
| **A** | `305` | Show HUD, then cycle audio |
| **− / +** | `314` / `315` | Volume |
| **L / R** | `310` / `311` | Tabs, or large seek in playback |
| **⌂** | `316` | Home |
| **↑** | D-pad | Show HUD, then cycle subtitles |

**B is select.** Do not document Xbox-style “A confirms”. Live and
YouTube ignore **X**. Ordinary power-on is the reconnect path; pairing
mode is recovery only.

One-time reliability install, after Git deploy:

```bash
cd ~/mango
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --apply
```

If input is missing, collect
`scripts/m1-foundation/pad/controller-link-diagnose.sh` before unpairing.

## Display sleep

The locked contract is Settings presets Off / 15 / 30 (default) / 60 /
120 minutes, idle reset from D-pad and companion only, mpv inhibition,
DPMS Off + CEC standby, DPMS On + CEC power-on. **It is not
implemented.** Accidental Xorg 600-second DPMS is a transitional defect,
not the product.

## Addon hosting

AIOStreams and AIOMetadata run on the Pi when you choose the example
compose files: [reference/addon-stack.md](reference/addon-stack.md).
ElfHosted is a paid fallback only. Hosting addons does not prove
playability.
