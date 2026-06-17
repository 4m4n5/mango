# Kodi + YouTube — setup from scratch

8BitDo Micro in Kodi: **D-pad** move · **B** select · **Y** back.

## Part 0 — InputStream Adaptive (fixes “19.0.0 cannot be satisfied”)

YouTube requires **InputStream Adaptive**. On Raspberry Pi OS it is **not** in Kodi’s add-on browser — install via **apt** first:

```bash
cd ~/mango && git pull
bash scripts/phase0/install-kodi-inputstream.sh
```

If you see *“dependency on inputstream.adaptive version 19.0.0 cannot be satisfied”*, this step was skipped. After install, **quit and reopen Kodi**, then retry the YouTube zip.

---

## Part 1 — Clean slate (SSH)

```bash
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
4. Complete the wizard — then **you must add personal API keys** (wizard defaults no longer load lists)

### All lists erroring? → Personal API keys (required)

Symptom: **Subscriptions**, **Trending**, **Search**, etc. all show errors. The addon is installed correctly; Google blocks anonymous API access.

**Diagnose on the Pi:**

```bash
bash scripts/phase0/diagnose-kodi-youtube.sh
```

If `API key` / `API id` / `API secret` show **EMPTY**, follow the steps below.

#### A — Create credentials (Mac browser)

Official 2026 walkthrough: [GitHub issue #1376](https://github.com/anxdpanic/plugin.video.youtube/issues/1376)

Summary:

1. [Google Cloud Console](https://console.cloud.google.com/) → **Create project**
2. **APIs & Services** → **Enable APIs** → enable **YouTube Data API v3**
3. **Create credentials** → **API key** → copy the key
4. **OAuth consent screen** → External app → add yourself as a **Test user**
5. **Create OAuth client** → type **TV and Limited Input devices** (not Desktop) → copy **Client ID** + **Client secret**

You need all three: **API key**, **Client ID**, **Client secret**.

#### B — Enter keys on the Pi (no USB keyboard needed)

1. In Kodi: **YouTube** → **Settings** → **API** → enable **API configuration page**
2. On your Mac, open: `http://10.0.0.174:50152/youtube/api` (replace with Pi IP if different)
3. Paste API key, Client ID, Client secret → Save
4. In Kodi: **YouTube** → **Sign in** → follow the device-code flow (use Mac/phone browser when prompted)
5. **Quit and reopen Kodi**, then try a list again

Wiki: [Personal API Keys](https://github.com/anxdpanic/plugin.video.youtube/wiki/Personal-API-Keys)

**Common mistakes:** OAuth client type **Desktop** instead of **TV and Limited Input**; forgot **Test user** on consent screen; keys entered in `api_keys.json` but old values still in Kodi GUI (clear GUI fields or re-enter both).

### Test playback

1. YouTube addon → **Search** → type a query (USB keyboard for typing, or use **Search by URL**)
2. Pick a video → **B**
3. Confirm it plays with **D-pad / B / Y** still working

---

## Part 5 — JSON-RPC (for later voice control)

Kodi requires a **non-empty password** when HTTP auth is on — the UI error *"if web server auth is enabled, password must be entered"* means the password field is blank.

### Option A — SSH (easiest)

```bash
killall kodi 2>/dev/null || true
bash scripts/phase0/kodi-enable-rpc.sh mango yourpassword
bash scripts/phase0/launch-kodi.sh
bash scripts/phase0/test-kodi-rpc.sh mango yourpassword
```

### Option B — Kodi UI (needs a keyboard to type the password)

1. **Settings** → **Services** → **Control** → **B**
2. **Allow remote control via HTTP** → **ON**
3. **Port:** `8080`
4. **Username:** e.g. `mango`
5. **Password:** type something (cannot be empty) — use a **USB keyboard** or on-screen keyboard
6. **Y** back to home

```bash
bash scripts/phase0/test-kodi-rpc.sh mango yourpassword
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
| **All lists error / empty** | Personal API keys required — Part 4 above; `diagnose-kodi-youtube.sh` |
| **inputstream.adaptive 19.0.0 cannot be satisfied** | `bash scripts/phase0/install-kodi-inputstream.sh` → restart Kodi → install zip again |
| Can't find zip in browser | Path is `/home/aman/mango/downloads/` — use **Home folder → mango → downloads** |
| "Dependencies not met" | Run reset script again; install zip before opening YouTube |
| Addon installed but won't open | **YouTube** → **Settings** → **Maintenance** → **Delete settings.xml** → run Setup wizard again |
| Login **Invalid client type** | Recreate OAuth client as **TV and Limited Input devices** |
| D-pad dead in Kodi | `bash scripts/phase0/map-pro-controller.sh` then relaunch Kodi |
| Repo install fails | Ignore repo; use zip method (Part 3) |
| Python threading errors in SSH after launch | Harmless input-remapper noise on exit — ignore |
