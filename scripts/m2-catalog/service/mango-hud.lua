-- mango playback HUD — rendered inside mpv's own pipeline (libass OSD overlay).
--
-- Replaces the external Tkinter X11 overlay window. A separate top-level window
-- over fullscreen mpv breaks the unredirected page-flip fast path on the Pi
-- (Openbox, no compositor) and stutters playback whenever the HUD is visible.
-- Drawing the HUD as an ASS overlay keeps a single window (mpv), so the direct
-- scanout path is preserved and the HUD costs ~nothing when hidden.
--
-- Triggered over the existing mpv IPC socket:
--   script-message mango-hud-show [reason]
--   script-message mango-hud-hide
-- Auto-hides after MANGO_PLAYBACK_OSD_VISIBLE_SEC (default 4s). Writes the same
-- playback-osd.visible state file the pad reads for its show-first gating.

local mp = require("mp")

local VISIBLE_SEC = tonumber(os.getenv("MANGO_PLAYBACK_OSD_VISIBLE_SEC") or "4.0") or 4.0
local HOME = os.getenv("HOME") or "/home/aman"
local VISIBLE_FILE = os.getenv("MANGO_PLAYBACK_OSD_VISIBLE_FILE")
  or (HOME .. "/.cache/mango/playback-osd.visible")

-- 1080p reference canvas; mpv scales the overlay to the panel so the HUD keeps a
-- constant physical footprint at both 1080p and 4K.
local CANVAS_W, CANVAS_H = 1920, 1080
local BOX_W, BOX_H = 1280, 172
local BOX_X = math.floor((CANVAS_W - BOX_W) / 2)
local BOX_Y = CANVAS_H - BOX_H - 48
local PAD = 34
local L = BOX_X + PAD
local R = BOX_X + BOX_W - PAD
local ROW1 = BOX_Y + 22
local ROW2 = BOX_Y + 50
local ROW3 = BOX_Y + 72
local ROW4 = BOX_Y + 94
local ROW5 = BOX_Y + 116
local TRACK_Y = BOX_Y + 138
local TRACK_W = BOX_W - PAD * 2
local TRACK_H = 10
local LEGEND_Y = BOX_Y + 156
local THUMB_R = 9

-- ASS colours are &HBBGGRR&; alpha bytes are &HAA& (00 opaque .. FF transparent).
local C_ELAPSED = "&H00dff1f7&"
local C_REMAIN = "&H00a0c6d7&"
local C_STATUS = "&H00a5bcc5&"
local C_GREEN = "&H00a8d49f&"
local C_RED = "&H009fa0d4&"
local C_BOX = "&H00060807&"
local C_TRACK = "&H003d4b51&"
local C_FILL = "&H004cb8ff&"
local C_FILL_PAUSE = "&H005c7a8a&"
local C_THUMB = "&H00a3e1ff&"
local C_THUMB_PAUSE = "&H008aa8b8&"
local C_LEGEND = "&H00a5bcc5&"
local C_OUTLINE = "&H00000000&"
local A_BOX = "&H12&"
local A_TRACK = "&H2c&"

local overlay = mp.create_osd_overlay("ass-events")
overlay.res_x = CANVAS_W
overlay.res_y = CANVAS_H
overlay.z = 10

local visible = false
local hide_timer = nil
local tick_timer = nil

local function write_visible_state(is_visible)
  local payload = string.format(
    '{"visible":%s,"ts":%d,"visible_sec":%.1f}\n',
    tostring(is_visible),
    os.time(),
    VISIBLE_SEC
  )
  local tmp = VISIBLE_FILE .. ".hud.tmp"
  local f = io.open(tmp, "w")
  if not f then
    return
  end
  f:write(payload)
  f:close()
  os.rename(tmp, VISIBLE_FILE)
end

local function ass_escape(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\239\187\191") -- guard backslashes (rare in labels)
  s = s:gsub("{", "\\{"):gsub("}", "\\}")
  return s
end

local function fmt_time(t)
  t = math.max(0, math.floor(t or 0))
  local h = math.floor(t / 3600)
  local m = math.floor((t % 3600) / 60)
  local s = t % 60
  if h > 0 then
    return string.format("%d:%02d:%02d", h, m, s)
  end
  return string.format("%d:%02d", m, s)
end

local function trim(s)
  return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function track_id_active(id)
  if id == nil then
    return false
  end
  if type(id) == "string" then
    local low = id:lower()
    if low == "" or low == "no" or low == "null" then
      return false
    end
    local n = tonumber(id)
    if n then
      id = n
    else
      return low == "auto"
    end
  end
  if type(id) == "number" then
    return id > 0
  end
  return false
end

local function track_label(tracks, id, ttype, empty)
  if not track_id_active(id) then
    return empty
  end
  local num = tonumber(id)
  if not num then
    return empty
  end
  num = math.floor(num)
  if num < 0 then
    return empty
  end
  if type(tracks) ~= "table" then
    return "Track " .. num
  end
  for _, t in ipairs(tracks) do
    if type(t) == "table" and t.type == ttype and t.id == num then
      local lang = trim(t.lang)
      local title = trim(t.title or t["external-filename"])
      local codec = trim(t.codec)
      local label
      if title ~= "" and lang ~= "" and not title:lower():find(lang:lower(), 1, true) then
        label = title .. " (" .. lang:upper() .. ")"
      elseif title ~= "" then
        label = title
      elseif lang ~= "" then
        label = lang:upper()
      else
        label = "Track " .. num
      end
      if ttype == "audio" and codec ~= "" and not label:lower():find(codec:lower(), 1, true) then
        label = label .. " · " .. codec:upper()
      end
      return label
    end
  end
  return "Track " .. num
end

local function is_4k_label(s)
  s = tostring(s or "")
  return s:find("3840", 1, true) or s:find("2160", 1, true) or s:find("4096", 1, true)
end

local function text_ev(an, x, y, size, colour, text, bold)
  return string.format(
    "{\\an%d\\pos(%d,%d)\\fnDejaVu Sans\\fs%d\\1c%s\\3c%s\\bord1\\shad0%s\\q2}%s",
    an, x, y, size, colour, C_OUTLINE, bold and "\\b1" or "", ass_escape(text)
  )
end

local function rect_ev(x, y, w, h, colour, alpha)
  return string.format(
    "{\\an7\\pos(%d,%d)\\1c%s\\1a%s\\bord0\\shad0\\p1}m 0 0 l %d 0 %d %d 0 %d{\\p0}",
    x, y, colour, alpha or "&H00&", w, w, h, h
  )
end

local function circle_ev(cx, cy, r, colour)
  local k = math.floor(r * 0.5523 + 0.5)
  return string.format(
    "{\\an7\\pos(%d,%d)\\1c%s\\bord0\\shad0\\p1}"
      .. "m %d 0 b %d %d %d %d 0 %d b %d %d %d %d %d 0 b %d %d %d %d 0 %d b %d %d %d %d %d 0{\\p0}",
    cx, cy, colour,
    -r, -r, -k, -k, -r, -r,
    k, -r, r, -k, r,
    r, k, k, r, r,
    -k, r, -r, k, -r
  )
end

local function build_ass()
  local pos = mp.get_property_number("time-pos") or 0
  local dur = mp.get_property_number("duration") or 0
  local paused = mp.get_property_native("pause") == true
  local tracks = mp.get_property_native("track-list")

  local sub_vis = mp.get_property_native("sub-visibility") == true
  local sid = mp.get_property_native("sid")
  local subs_on = sub_vis and track_id_active(sid)
  local subs_label = subs_on and track_label(tracks, sid, "sub", "Off") or "Off"

  local aid = mp.get_property_native("aid")
  local audio_label = track_label(tracks, aid, "audio", "Default")

  local parts = {}
  local vw = mp.get_property_number("width")
  local vh = mp.get_property_number("height")
  local vcodec = mp.get_property_native("video-codec")
  local hwdec = mp.get_property_native("hwdec-current")
  if vw and vh and vw > 0 and vh > 0 then
    parts[#parts + 1] = string.format("%d×%d", math.floor(vw), math.floor(vh))
  end
  if type(vcodec) == "string" and vcodec ~= "" then
    parts[#parts + 1] = vcodec:upper()
  end
  if type(hwdec) == "string" and hwdec ~= "" and hwdec ~= "no" then
    parts[#parts + 1] = "hw:" .. hwdec
  end
  local video_label = #parts > 0 and table.concat(parts, " · ") or "—"

  local display_label = "—"
  local od = mp.get_property_native("osd-dimensions")
  if type(od) == "table" and od.w and od.h and od.w > 0 and od.h > 0 then
    display_label = string.format("%dx%d", math.floor(od.w), math.floor(od.h))
  end

  local pct = 0.0
  if dur > 0 then
    pct = math.max(0.0, math.min(1.0, pos / dur))
  end
  local remain_label = dur > 0 and ("-" .. fmt_time(dur - pos)) or "LIVE"

  local video_colour = is_4k_label(video_label) and C_GREEN or C_STATUS
  local display_colour = C_STATUS
  if is_4k_label(display_label) then
    display_colour = C_GREEN
  elseif tostring(display_label):find("1920", 1, true) then
    display_colour = C_RED
  end

  local ev = {}
  ev[#ev + 1] = rect_ev(BOX_X, BOX_Y, BOX_W, BOX_H, C_BOX, A_BOX)
  ev[#ev + 1] = text_ev(7, L, ROW1, 30, paused and "&H00b4c2c9&" or C_ELAPSED, fmt_time(pos), true)
  ev[#ev + 1] = text_ev(9, R, ROW1, 24, C_REMAIN, remain_label, false)
  ev[#ev + 1] = text_ev(7, L, ROW2, 19, C_STATUS, "Subtitles: " .. (subs_on and "On" or "Off"), false)
  ev[#ev + 1] = text_ev(9, R, ROW2, 19, C_STATUS, "Sub: " .. subs_label, false)
  ev[#ev + 1] = text_ev(7, L, ROW3, 19, C_STATUS, "Audio: " .. audio_label, false)
  ev[#ev + 1] = text_ev(7, L, ROW4, 18, video_colour, "Video: " .. video_label, false)
  ev[#ev + 1] = text_ev(7, L, ROW5, 18, display_colour, "Display: " .. display_label, false)

  ev[#ev + 1] = rect_ev(L, TRACK_Y, TRACK_W, TRACK_H, C_TRACK, A_TRACK)
  local fill_w = math.floor(TRACK_W * pct)
  if fill_w > 0 then
    ev[#ev + 1] = rect_ev(L, TRACK_Y, fill_w, TRACK_H, paused and C_FILL_PAUSE or C_FILL, "&H00&")
  end
  ev[#ev + 1] = circle_ev(L + fill_w, TRACK_Y + math.floor(TRACK_H / 2), THUMB_R, paused and C_THUMB_PAUSE or C_THUMB)

  ev[#ev + 1] = text_ev(
    7, L, LEGEND_Y, 16, C_LEGEND,
    "B pause   ←/→ seek   ↑ osd/subs   A audio   ± vol   Y back", false
  )

  return table.concat(ev, "\n")
end

local function render()
  if not visible then
    return
  end
  overlay.data = build_ass()
  overlay:update()
end

local function hide()
  if hide_timer then
    hide_timer:kill()
    hide_timer = nil
  end
  if tick_timer then
    tick_timer:kill()
    tick_timer = nil
  end
  if visible then
    visible = false
    overlay:remove()
    write_visible_state(false)
  end
end

local function show(reason)
  visible = true
  write_visible_state(true)
  render()
  if tick_timer then
    tick_timer:kill()
  end
  -- 1 Hz while visible: crawl the progress/time without competing with mpv.
  tick_timer = mp.add_periodic_timer(1.0, render)
  if hide_timer then
    hide_timer:kill()
  end
  hide_timer = mp.add_timeout(VISIBLE_SEC, hide)
end

mp.register_script_message("mango-hud-show", function(reason)
  show(reason or "show")
end)
mp.register_script_message("mango-hud-hide", function()
  hide()
end)

mp.register_event("shutdown", function()
  pcall(write_visible_state, false)
end)
