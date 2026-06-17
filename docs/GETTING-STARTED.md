# Phase 0 — Getting started (hardware)

Do this **before** running any scripts. Project hostname: **`mango`**.

---

## What’s in your CanaKit box

| Item | Use in Phase 0 |
|------|----------------|
| Raspberry Pi 5 board | The computer |
| 128GB microSD card | Operating system (flash first on Mac, then insert in Pi) |
| USB microSD card reader (small USB dongle) | Plug SD into Mac for flashing |
| 45W USB-C power supply | Powers the Pi — use this, not a phone charger |
| Micro-HDMI → HDMI cable | Pi → TV |
| Case + fan | Install on Pi before long use (see below) |

Also have ready: **TV (HDMI)**, **USB gamepad receiver**, **phone**, **Ethernet cable** (recommended).

---

## Step 1 — Flash the SD card (on your Mac)

### 1.1 Put the SD card in the Mac

1. **Power off everything** — the Pi should not be connected yet.
2. Find the **microSD card** in the kit (small chip, often labeled 128GB).
3. Find the **USB card reader dongle** (USB-A on one end, microSD slot on the other).
4. **Slide the microSD into the dongle:**
   - Gold contacts **face down** into the slot (toward the circuit board of the dongle).
   - Push gently until it **clicks** (spring-loaded slot).
5. Plug the dongle into a **USB port on your Mac**.
6. macOS may mount a volume named `bootfs` or similar — that’s normal.

### 1.2 Flash with Raspberry Pi Imager

1. Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/) if needed; open it.
2. **Choose device** → **Raspberry Pi 5**.
3. **Choose OS** → **Raspberry Pi OS (64-bit)** — pick the full **Desktop** image (with recommended software), **not** Lite.
4. **Choose storage** → select your **128GB microSD** (check size so you don’t wipe the wrong disk).
5. Click **Next** → open the **OS customization** gear:
   - **Set hostname:** `mango`
   - **Set username and password** — write these down
   - **Configure wireless LAN** (SSID + password) *or* skip if using Ethernet only
   - **Enable SSH:** ON (use password authentication)
   - **Set locale / timezone** as needed
6. **Write** → confirm → wait until “Write successful”.
7. **Eject** the SD safely on your Mac (Finder → Eject).
8. **Remove the microSD from the dongle** (push to release).

---

## Step 2 — Assemble the Pi and insert the SD card (at the TV)

### 2.1 Case and cooling (recommended before first long session)

Follow CanaKit’s leaflet: attach the **fan/heatsink** to the Pi, snap board into **Turbine case**.  
If the case blocks the SD slot, use the **access slot in the case floor** aligned with the card slot.

### 2.2 Where the microSD goes in the Raspberry Pi 5

The Pi 5 slot is on the **underside** of the board (the flat side **without** the big GPIO pins).

1. **Unplug power** — Pi must be off.
2. Hold the Pi so you can see the **bottom** (often easier before the case is closed).
3. Find the **microSD slot** on the bottom edge — narrow slot, labeled **microSD** on the PCB.
4. Insert the card:
   - **Gold contacts face up** toward the Pi board.
   - **Label side** often faces the table.
   - Push **straight in** along the slot until you feel a **click**.
5. Do **not** force it at an angle; if it doesn’t slide, flip the card over and try again.

```
        [ USB-C power ]  [ HDMI ]  [ USB ports ]   ← top of Pi (ports side)

        ═══════════════════════════════════════
                    Pi 5 board
        ═══════════════════════════════════════
              ┌─────────────┐
              │  microSD ◄──┼── insert on BOTTOM (underside)
              └─────────────┘
```

### 2.3 Connect everything

| Port on Pi | Plug in |
|-----------|---------|
| **USB-C** (power, separate from data USB) | CanaKit **45W** power brick |
| **micro-HDMI** (either port) | HDMI cable → TV |
| **USB-A** | Gamepad **wireless receiver** dongle |
| **Ethernet** (optional) | Cable → router |

Turn on the **TV** and select the correct HDMI input **before** powering the Pi.

### 2.4 First power-on

1. Plug in **USB-C power** — Pi fans/LEDs come on; first boot takes **2–5 minutes**.
2. Complete any on-screen setup wizard (country, password, WiFi if not set in Imager).
3. You should land on the **Raspberry Pi desktop**.

---

## Step 3 — Verify and tell your collaborator

On the Pi, open **Terminal** and run:

```bash
hostname -I          # note the IP (e.g. 10.0.0.x)
echo $USER           # note username
```

Reply with:

- Pi **IP address**
- **Username**
- **Ethernet or WiFi**
- **Desktop boots OK?** (yes/no)

From your Mac we’ll SSH in and run:

```bash
git clone https://github.com/4m4n5/mango.git
cd mango
bash scripts/phase0/bootstrap.sh
```

---

## Step 4 — Software checklist

After SSH works, continue with [`phase0-checklist.md`](phase0-checklist.md):

- Switch to **X11**
- Map **gamepad** (antimicrox)
- Install **Kodi** + **Stremio**
- Test from couch with gamepad only

---

## Troubleshooting

| Problem | Try |
|---------|-----|
| Mac doesn’t see SD | Reseat card in dongle; try another USB port |
| Pi won’t boot / rainbow screen | Re-flash SD; ensure 64-bit Desktop image |
| No HDMI picture | Try the other micro-HDMI port; check TV input |
| SD won’t fit | Wrong side — contacts must face the board on underside slot |
| Can’t SSH from Mac | Same WiFi/network? SSH enabled in Imager? Use IP not hostname |
