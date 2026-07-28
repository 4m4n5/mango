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
local utils = require("mp.utils")

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
local mode = "hud"
local stream_state = nil
local stream_index = 1
local stream_poll_timer = nil
local render
local CATALOG_URL = os.getenv("MANGO_CATALOG_URL") or "http://127.0.0.1:3020"
local STREAM_STATE_FILE = os.getenv("MANGO_ACTIVE_STREAMS_PATH")
  or (HOME .. "/.cache/mango/active-streams.json")

local function write_visible_state(is_visible)
  local payload = string.format(
    '{"visible":%s,"mode":"%s","ts":%d,"visible_sec":%.1f}\n',
    tostring(is_visible),
    mode,
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

local function read_stream_state()
  local file = io.open(STREAM_STATE_FILE, "r")
  if not file then
    return nil
  end
  local raw = file:read("*a")
  file:close()
  local parsed = utils.parse_json(raw)
  if type(parsed) ~= "table" or parsed.enabled ~= true or parsed.session_id == nil then
    return nil
  end
  return parsed
end

local function stream_action_count()
  if type(stream_state) ~= "table" then
    return 0
  end
  return stream_state.undo_available == true and 2 or 1
end

local function stream_row_count()
  local candidates = type(stream_state) == "table" and stream_state.candidates or nil
  local count = type(candidates) == "table" and #candidates or 0
  return count + stream_action_count()
end

local function clamp_stream_index()
  local count = stream_row_count()
  if count <= 0 then
    stream_index = 1
    return
  end
  stream_index = math.max(1, math.min(count, stream_index))
end

local function stream_candidate_summary(candidate)
  local parts = {
    candidate.resolution or "Unknown",
    candidate.hdr or "SDR",
    candidate.codec or "Unknown",
    candidate.cache or "unknown",
    candidate.source or "Source",
  }
  return table.concat(parts, "  ·  ")
end

local function stream_candidate_detail(candidate)
  local parts = {}
  for _, value in ipairs({
    candidate.size,
    candidate.bitrate,
    candidate.release_group,
    candidate.audio,
    candidate.risk,
  }) do
    if type(value) == "string" and value ~= "" then
      parts[#parts + 1] = value
    end
  end
  if #parts == 0 then
    return candidate.capability_class == "proven_smooth"
      and "Proven fit for this playback path"
      or "Technical details will be learned after validation"
  end
  return table.concat(parts, "  ·  ")
end

local function build_streams_ass()
  local panel_w, panel_h = 1320, 760
  local panel_x = math.floor((CANVAS_W - panel_w) / 2)
  local panel_y = math.floor((CANVAS_H - panel_h) / 2)
  local left = panel_x + 54
  local right = panel_x + panel_w - 54
  local candidates = type(stream_state) == "table" and stream_state.candidates or {}
  local ev = {}
  ev[#ev + 1] = rect_ev(panel_x, panel_y, panel_w, panel_h, C_BOX, "&H08&")
  ev[#ev + 1] = text_ev(7, left, panel_y + 42, 34, C_ELAPSED, "Streams", true)
  ev[#ev + 1] = text_ev(
    9, right, panel_y + 46, 17, C_LEGEND,
    stream_state and (
      stream_state.status == "checking" and "Checking stream…"
      or stream_state.status == "switching" and "Switching…"
      or stream_state.status == "failed" and "Playback stopped"
      or "Ready"
    ) or "Unavailable", false
  )

  if not stream_state or #candidates == 0 then
    ev[#ev + 1] = text_ev(5, CANVAS_W / 2, panel_y + 330, 25, C_STATUS,
      "No alternate streams are available for this title.", false)
    ev[#ev + 1] = text_ev(5, CANVAS_W / 2, panel_y + 385, 18, C_LEGEND,
      "Y closes", false)
    return table.concat(ev, "\n")
  end

  local row_y = panel_y + 106
  local row_h = 58
  for index, candidate in ipairs(candidates) do
    local selected = stream_index == index
    local colour = candidate.capability_class == "known_risky" and C_RED or C_STATUS
    if selected then
      ev[#ev + 1] = rect_ev(left - 18, row_y - 10, panel_w - 72, row_h - 4, C_TRACK, "&H18&")
      colour = C_ELAPSED
    end
    local marker = candidate.current and "● " or "  "
    if candidate.unavailable then
      marker = "× "
      colour = C_LEGEND
    end
    ev[#ev + 1] = text_ev(7, left, row_y, 23, colour,
      marker .. stream_candidate_summary(candidate), candidate.current == true)
    if candidate.capability_class == "known_risky" then
      ev[#ev + 1] = text_ev(9, right, row_y, 16, C_RED, "FINAL FALLBACK", true)
    end
    row_y = row_y + row_h
  end

  local action_index = #candidates + 1
  local action_selected = stream_index == action_index
  if action_selected then
    ev[#ev + 1] = rect_ev(left - 18, row_y - 10, panel_w - 72, row_h - 4, C_TRACK, "&H18&")
  end
  ev[#ev + 1] = text_ev(7, left, row_y, 22,
    action_selected and C_ELAPSED or C_GREEN, "Try smoother source", true)
  if stream_state.undo_available == true then
    row_y = row_y + row_h
    local undo_selected = stream_index == action_index + 1
    if undo_selected then
      ev[#ev + 1] = rect_ev(left - 18, row_y - 10, panel_w - 72, row_h - 4, C_TRACK, "&H18&")
    end
    ev[#ev + 1] = text_ev(7, left, row_y, 22,
      undo_selected and C_ELAPSED or C_STATUS, "Undo", true)
  end

  local focused = candidates[stream_index]
  local detail = focused and stream_candidate_detail(focused)
    or (stream_state.error or "Downranks this source for seven days; you still choose the replacement.")
  ev[#ev + 1] = text_ev(7, left, panel_y + panel_h - 76, 17, C_LEGEND, detail, false)
  ev[#ev + 1] = text_ev(9, right, panel_y + panel_h - 38, 17, C_LEGEND,
    "↑/↓ choose   B select   Y close", false)
  return table.concat(ev, "\n")
end

local function refresh_stream_state()
  local next_state = read_stream_state()
  if next_state then
    stream_state = next_state
    clamp_stream_index()
    if mode == "streams" and visible then
      overlay.data = build_streams_ass()
      overlay:update()
    end
  end
end

local function post_stream_action(path, body)
  local payload = utils.format_json(body)
  mp.command_native_async({
    name = "subprocess",
    playback_only = false,
    capture_stdout = true,
    capture_stderr = true,
    args = {
      "curl", "-sS", "--max-time", "4",
      "-H", "content-type: application/json",
      "--data", payload,
      CATALOG_URL .. path,
    },
  }, function(_, result)
    if type(result) == "table" and type(result.stdout) == "string" then
      local parsed = utils.parse_json(result.stdout)
      if type(parsed) == "table" and type(parsed.streams) == "table" then
        stream_state = parsed.streams
      end
    end
    refresh_stream_state()
  end)
end

local function build_ass()
  if mode == "streams" then
    return build_streams_ass()
  end
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
    "B pause   ←/→ seek   ↑ osd/subs   X streams   A audio   ± vol   Y back", false
  )

  return table.concat(ev, "\n")
end

render = function()
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
  if stream_poll_timer then
    stream_poll_timer:kill()
    stream_poll_timer = nil
  end
  if visible then
    visible = false
    overlay:remove()
    write_visible_state(false)
  end
end

local function show(reason)
  mode = "hud"
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

local function close_streams()
  mode = "hud"
  stream_state = nil
  stream_index = 1
  hide()
end

local function open_streams()
  stream_state = read_stream_state()
  if not stream_state then
    mp.osd_message("Streams are unavailable for this playback.", 2)
    return
  end
  mode = "streams"
  visible = true
  stream_index = 1
  local candidates = stream_state.candidates or {}
  for index, candidate in ipairs(candidates) do
    if candidate.current == true then
      stream_index = index
      break
    end
  end
  if hide_timer then
    hide_timer:kill()
    hide_timer = nil
  end
  if tick_timer then
    tick_timer:kill()
    tick_timer = nil
  end
  if stream_poll_timer then
    stream_poll_timer:kill()
  end
  stream_poll_timer = mp.add_periodic_timer(1.0, refresh_stream_state)
  write_visible_state(true)
  render()
end

mp.register_script_message("mango-hud-show", function(reason)
  show(reason or "show")
end)
mp.register_script_message("mango-hud-hide", function()
  hide()
end)
mp.register_script_message("mango-streams-toggle", function()
  if mode == "streams" and visible then
    close_streams()
  else
    open_streams()
  end
end)
mp.register_script_message("mango-streams-close", function()
  if mode == "streams" then
    close_streams()
  end
end)
mp.register_script_message("mango-streams-move", function(delta)
  if mode ~= "streams" or not visible then
    return
  end
  local count = stream_row_count()
  if count <= 0 then
    return
  end
  stream_index = ((stream_index - 1 + (tonumber(delta) or 0)) % count) + 1
  render()
end)
mp.register_script_message("mango-streams-select", function()
  if mode ~= "streams" or not visible or type(stream_state) ~= "table" then
    return
  end
  if stream_state.status == "checking" or stream_state.status == "switching" then
    return
  end
  local candidates = stream_state.candidates or {}
  local selected = candidates[stream_index]
  local common = {
    session_id = stream_state.session_id,
    revision = stream_state.revision,
  }
  if selected then
    if selected.current == true or selected.unavailable == true then
      return
    end
    common.candidate_id = selected.candidate_id
    stream_state.status = "checking"
    render()
    post_stream_action("/play-session/active/streams/switch", common)
    return
  end
  local action_index = #candidates + 1
  if stream_index == action_index then
    common.reason = "user requested a smoother source"
    post_stream_action("/play-session/active/streams/issue", common)
  elseif stream_state.undo_available == true and stream_index == action_index + 1 then
    post_stream_action("/play-session/active/streams/issue/undo", common)
  end
end)

mp.register_event("shutdown", function()
  pcall(write_visible_state, false)
end)
