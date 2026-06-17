# Getting started

Phase 0 hardware setup on your Pi 5 CanaKit. Software steps: [`phase0-checklist.md`](phase0-checklist.md).

## Flash the SD card (Mac)

1. Insert microSD into the CanaKit USB reader → plug into Mac.
2. Open **Raspberry Pi Imager** → Pi 5 → **Raspberry Pi OS (64-bit) Desktop**.
3. In settings: hostname **`mango`**, user/password, WiFi or Ethernet, **SSH on**.
4. Write to SD, eject, remove from reader.

## Boot the Pi

1. Insert microSD in the Pi’s **underside slot** (Pi off, contacts toward board).
2. HDMI to TV, USB gamepad receiver, Ethernet optional, then power via USB-C.
3. First boot takes a few minutes; finish the desktop wizard if prompted.

## Hand off to software

On the Pi terminal:

```bash
hostname -I    # note IP for SSH
```

From your Mac (once we have IP + user):

```bash
git clone https://github.com/4m4n5/mango.git
cd mango
bash scripts/phase0/bootstrap.sh
```

See [`phase0-checklist.md`](phase0-checklist.md) for the rest.
