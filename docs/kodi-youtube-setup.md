# Kodi + YouTube — setup from scratch

8BitDo Micro in Kodi: **D-pad** move · **B** select · **Y** back.

## Part 1 — Clean slate (SSH)

```bash
cd ~/mango && git pull
bash scripts/phase0/reset-kodi-youtube.sh
bash scripts/phase0/launch-kodi.sh
```

This deletes any broken YouTube install and downloads `plugin.video.youtube-7.4.3.zip` to `~/mango/downloads/`.

---

## Part 2 — Enable zip installs (Kodi, one time)

1. From Kodi **home**, move to the **gear** icon (Settings) on the left → **B**
2. **System** → **B**
3. Move to the **gear** at the bottom left until it says **Expert** → **B**
4. **Add-ons** (left column) → **B**
5. Turn **Unknown sources** **ON** → confirm the warning with **B** (Yes)
6. **Y** back until you reach Kodi home

---

## Part 3 — Install YouTube from zip

1. **Settings** (gear) → **Add-ons** → **B**
2. **Install from zip file** → **B**
3. Navigate to:
   - **Home folder** → **mango** → **downloads** → **B**
   - Select **plugin.video.youtube-7.4.3.zip** → **B**
4. Wait for **Add-on installed** notification (top right)
5. **Y** back to home

**If zip install fails:** check the zip exists on the Pi:

```bash
ls -la ~/mango/downloads/plugin.video.youtube-7.4.3.zip
```

Re-run `reset-kodi-youtube.sh` if missing.

---

## Part 4 — First-run YouTube setup

1. Kodi **home** → **Add-ons** → **B**
2. **Video add-ons** → **YouTube** → **B** (open)
3. When prompted, run **Setup wizard** → **B** → **Yes**
4. Complete the wizard (defaults are fine for a first test)
5. If it asks you to **Sign in**, follow on-screen steps (phone/PC may be needed for Google login)

### If videos won't play (API keys)

YouTube often requires **personal API keys**. Short version:

1. In the YouTube addon: **Settings** → **API**
2. Create keys at [Google Cloud Console](https://console.cloud.google.com/) — enable **YouTube Data API v3**, create an **API key** and **OAuth client** (TV/Desktop type)
3. Enter **API Key**, **API Id** (client ID), **API Secret** in the addon
4. Sign in again from the addon

Details: [plugin.video.youtube wiki — Personal API Keys](https://github.com/anxdpanic/plugin.video.youtube/wiki/Personal-API-Keys)

### Test playback

1. YouTube addon → **Search** → type a query (USB keyboard for typing, or use **Search by URL**)
2. Pick a video → **B**
3. Confirm it plays with **D-pad / B / Y** still working

---

## Part 5 — JSON-RPC (for later voice control)

Still in Kodi **Settings** (Expert mode):

1. **Services** → **Control** → **B**
2. **Allow remote control via HTTP** → **ON**
3. **Web server port:** `8080`
4. Set **Username** and **Password** (pick something you'll remember)
5. **Y** back to home

On SSH:

```bash
bash scripts/phase0/test-kodi-rpc.sh <username> <password>
```

Expect: `✓ Kodi JSON-RPC OK`

---

## Alternative — official repository (optional)

If zip install worked before or you prefer the repo path:

**Settings** → **Add-ons** → **Install from repository** → **Kodi Add-on repository** → **Video add-ons** → **YouTube** → **Install**

Use this only if the repository loads; if it errors or hangs, use **Part 3 (zip)** instead.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Can't find zip in browser | Path is `/home/aman/mango/downloads/` — use **Home folder → mango → downloads** |
| "Dependencies not met" | Run reset script again; install zip before opening YouTube |
| Addon installed but won't open | **YouTube** → **Settings** → **Maintenance** → **Delete settings.xml** → run Setup wizard again |
| D-pad dead in Kodi | `bash scripts/phase0/map-pro-controller.sh` then relaunch Kodi |
| Repo install fails | Ignore repo; use zip method (Part 3) |
