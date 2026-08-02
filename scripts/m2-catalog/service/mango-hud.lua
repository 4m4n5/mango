-- Mango cinematic playback HUD and in-player Streams drawer.
--
-- Everything is drawn into mpv's libass overlay. Keeping one fullscreen window
-- preserves the Pi's direct-scanout path; the legacy Tk overlay remains a
-- rollback-only backend. The script is idle until controller interaction, a
-- real buffering event, a pause badge, or a post-switch confirmation requires
-- chrome.

local mp = require("mp")
local utils = require("mp.utils")

local HOME = os.getenv("HOME") or "/home/aman"
local NORMAL_SEC = tonumber(os.getenv("MANGO_PLAYBACK_OSD_VISIBLE_SEC") or "4.0") or 4.0
local LONG_SEC = 6.0
local VISIBLE_FILE = os.getenv("MANGO_PLAYBACK_OSD_VISIBLE_FILE")
  or (HOME .. "/.cache/mango/playback-osd.visible")
local STREAM_STATE_FILE = os.getenv("MANGO_ACTIVE_STREAMS_PATH")
  or (HOME .. "/.cache/mango/active-streams.json")
local CATALOG_URL = os.getenv("MANGO_CATALOG_URL") or "http://127.0.0.1:3020"
local PLAYBACK_TITLE = os.getenv("MANGO_PLAYBACK_TITLE") or ""
local PLAYBACK_CONTEXT = os.getenv("MANGO_PLAYBACK_CONTEXT") or ""
local PLAYBACK_KIND = os.getenv("MANGO_PLAYBACK_KIND") or "unknown"
local START_CONFIRMATION = os.getenv("MANGO_PLAYBACK_CONFIRMATION") or ""
local START_REOPEN_STREAMS = os.getenv("MANGO_PLAYBACK_REOPEN_STREAMS") == "1"
local FIXTURES = os.getenv("MANGO_HUD_FIXTURES") == "1"

local CANVAS_W, CANVAS_H = 1920, 1080
local SAFE_X = 96
local HUD_X, HUD_Y, HUD_W, HUD_H = 192, 744, 1536, 272
local DRAWER_Y, DRAWER_H = 454, 626

-- ASS uses BBGGRR and 00..FF alpha.
local C_WHITE = "&H00F2F5F5&"
local C_MUTED = "&H00B1B6BA&"
local C_DIM = "&H00858B90&"
local C_CHARCOAL = "&H00161412&"
local C_ROW = "&H00282320&"
local C_ROW_CURRENT = "&H002B2720&"
local C_AMBER = "&H0020A0E8&" -- Mango #e8a020
local C_ERROR = "&H00656AEB&"
local C_BLACK = "&H00000000&"

local overlay = mp.create_osd_overlay("ass-events")
overlay.res_x = CANVAS_W
overlay.res_y = CANVAS_H
overlay.z = 10

local overlay_mode = "hidden"
local hud_reason = "show"
local visible = false
local hide_timer = nil
local tick_timer = nil
local buffering_timer = nil
local stream_poll_timer = nil
local buffering = false
local stream_state = nil
local stream_index = 1
local request_pending = false
local confirmation_until = 0
local fixture_name = nil
local render

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function clean_text(value)
  return trim(tostring(value or ""):gsub("[%z\1-\31\127]", " "):gsub("%s+", " "))
end

local function utf8_prefix(value, max_chars)
  local text = clean_text(value)
  local index, count, last = 1, 0, 0
  while index <= #text and count < max_chars do
    local byte = text:byte(index)
    local width = byte < 0x80 and 1 or byte < 0xE0 and 2 or byte < 0xF0 and 3 or 4
    if index + width - 1 > #text then break end
    last = index + width - 1
    index = index + width
    count = count + 1
  end
  if index <= #text then return text:sub(1, last) .. "…" end
  return text
end

local function ass_escape(value)
  local text = clean_text(value)
  text = text:gsub("\\", "\\\239\187\191")
  return text:gsub("{", "\\{"):gsub("}", "\\}")
end

local function fmt_time(value)
  local total = math.max(0, math.floor(tonumber(value) or 0))
  local hours = math.floor(total / 3600)
  local minutes = math.floor((total % 3600) / 60)
  local seconds = total % 60
  if hours > 0 then return string.format("%d:%02d:%02d", hours, minutes, seconds) end
  return string.format("%d:%02d", minutes, seconds)
end

local function text_ev(an, x, y, size, colour, text, bold)
  return string.format(
    "{\\an%d\\pos(%d,%d)\\fnDejaVu Sans\\fs%d\\1c%s\\3c%s\\bord1\\shad0%s\\q2}%s",
    an, x, y, size, colour, C_BLACK, bold and "\\b1" or "", ass_escape(text)
  )
end

local function rect_ev(x, y, width, height, colour, alpha)
  return string.format(
    "{\\an7\\pos(%d,%d)\\1c%s\\1a%s\\bord0\\shad0\\p1}m 0 0 l %d 0 %d %d 0 %d{\\p0}",
    x, y, colour, alpha or "&H00&", width, width, height, height
  )
end

local function write_visible_state(is_visible, state_mode)
  local payload = string.format(
    '{"visible":%s,"mode":"%s","ts":%d,"visible_sec":%.1f}\n',
    tostring(is_visible), state_mode or overlay_mode, os.time(), NORMAL_SEC
  )
  local temporary = VISIBLE_FILE .. ".hud.tmp"
  local file = io.open(temporary, "w")
  if not file then return end
  file:write(payload)
  file:close()
  os.rename(temporary, VISIBLE_FILE)
end

local function stop_timer(timer)
  if timer then timer:kill() end
  return nil
end

local function track_active(id)
  local number = tonumber(id)
  return number ~= nil and number > 0
end

local function selected_track(track_type)
  local property = track_type == "audio" and "aid" or "sid"
  local selected = mp.get_property_native(property)
  if not track_active(selected) then return nil end
  local tracks = mp.get_property_native("track-list")
  if type(tracks) ~= "table" then return nil end
  for _, track in ipairs(tracks) do
    if type(track) == "table" and track.type == track_type and tonumber(track.id) == tonumber(selected) then
      return track
    end
  end
  return nil
end

local function track_label(track, fallback)
  if type(track) ~= "table" then return fallback end
  local language = clean_text(track.lang):upper()
  local title = clean_text(track.title)
  if title ~= "" and language ~= "" and not title:upper():find(language, 1, true) then
    return title .. " (" .. language .. ")"
  end
  if title ~= "" then return title end
  if language ~= "" then return language end
  return fallback
end

local function resolution_label()
  local height = mp.get_property_number("height") or 0
  if height >= 2160 then return "4K" end
  if height >= 1440 then return "1440p" end
  if height >= 1080 then return "1080p" end
  if height >= 720 then return "720p" end
  if height > 0 then return math.floor(height) .. "p" end
  return nil
end

local function hdr_label()
  local gamma = clean_text(mp.get_property_native("video-params/gamma")):lower()
  if gamma:find("pq", 1, true) or gamma:find("hlg", 1, true) then return "HDR" end
  if gamma ~= "" and gamma ~= "unknown" then return "SDR" end
  return nil
end

local function codec_label()
  local codec = clean_text(mp.get_property_native("video-codec")):lower()
  if codec == "" then return nil end
  if codec:find("hevc", 1, true) or codec:find("h265", 1, true) then return "HEVC" end
  if codec:find("h264", 1, true) or codec:find("avc", 1, true) then return "AVC" end
  if codec:find("av1", 1, true) then return "AV1" end
  if codec:find("vp9", 1, true) then return "VP9" end
  return codec:upper()
end

local function audio_essential()
  local track = selected_track("audio")
  local language = type(track) == "table" and clean_text(track.lang):upper() or ""
  local channels = clean_text(mp.get_property_native("audio-params/hr-channels"))
  if channels == "" then
    local count = tonumber(mp.get_property_native("audio-params/channel-count"))
    if count then channels = count == 2 and "Stereo" or string.format("%g ch", count) end
  elseif channels == "stereo" then
    channels = "Stereo"
  else
    channels = channels:upper()
  end
  local pieces = {}
  if language ~= "" then pieces[#pieces + 1] = language end
  if channels ~= "" then pieces[#pieces + 1] = channels end
  if #pieces == 0 then return nil end
  return table.concat(pieces, " ")
end

local function technical_line()
  local pieces = {}
  for _, value in ipairs({ resolution_label(), hdr_label(), codec_label(), audio_essential() }) do
    if value and value ~= "" then pieces[#pieces + 1] = value end
  end
  return table.concat(pieces, "  ·  ")
end

local function display_title()
  local title = clean_text(PLAYBACK_TITLE)
  local context = clean_text(PLAYBACK_CONTEXT)
  if title == "" then title = "Playing" end
  if context ~= "" then title = title .. " · " .. context end
  return utf8_prefix(title, 68)
end

local function current_action(reason)
  reason = tostring(reason or "show")
  local seek = reason:match("^seek:([+-]?%d+)$")
  if seek then
    local amount = tonumber(seek) or 0
    return string.format("%s%d seconds", amount < 0 and "−" or "+", math.abs(amount)), NORMAL_SEC
  end
  if reason == "left" then return "−10 seconds", NORMAL_SEC end
  if reason == "right" then return "+10 seconds", NORMAL_SEC end
  if reason == "volume" then
    return "Volume " .. math.floor((mp.get_property_number("volume") or 0) + 0.5), NORMAL_SEC
  end
  if reason == "subs" then
    local visible_subs = mp.get_property_native("sub-visibility") == true
    local label = visible_subs and track_label(selected_track("sub"), "On") or "Off"
    return "Subtitles · " .. utf8_prefix(label, 42), LONG_SEC
  end
  if reason == "audio" then
    return "Audio · " .. utf8_prefix(track_label(selected_track("audio"), "Default"), 42), LONG_SEC
  end
  if reason == "pause" then return "Paused", NORMAL_SEC end
  if reason == "resume" then return "Playing", NORMAL_SEC end
  if reason == "error" then return "Playback needs attention", LONG_SEC end
  return display_title(), NORMAL_SEC
end

local function x_supported()
  return PLAYBACK_KIND ~= "tv" and PLAYBACK_KIND ~= "youtube_video"
end

local function contextual_hints()
  local paused = mp.get_property_native("pause") == true
  local hints = { paused and "B  Resume" or "B  Pause" }
  if x_supported() then hints[#hints + 1] = "X  Streams" end
  hints[#hints + 1] = "Y  Back"
  return table.concat(hints, "     ")
end

local function is_live()
  if fixture_name == "live" then return true end
  return PLAYBACK_KIND == "tv"
end

local function build_hud_ass()
  local position = mp.get_property_number("time-pos") or 0
  local duration = mp.get_property_number("duration") or 0
  local live = is_live()
  local headline = current_action(hud_reason)
  local tech = technical_line()
  local ev = {}
  ev[#ev + 1] = rect_ev(HUD_X, HUD_Y, HUD_W, HUD_H, C_CHARCOAL, "&H10&")
  ev[#ev + 1] = text_ev(7, HUD_X + 44, HUD_Y + 38, 42, C_WHITE, headline, true)
  if live then
    ev[#ev + 1] = rect_ev(HUD_X + HUD_W - 166, HUD_Y + 36, 104, 44, C_AMBER, "&H00&")
    ev[#ev + 1] = text_ev(5, HUD_X + HUD_W - 114, HUD_Y + 58, 28, C_CHARCOAL, "LIVE", true)
    if tech ~= "" then
      ev[#ev + 1] = text_ev(7, HUD_X + 44, HUD_Y + 112, 28, C_MUTED, tech, false)
    end
    ev[#ev + 1] = text_ev(7, HUD_X + 44, HUD_Y + 212, 28, C_MUTED, contextual_hints(), false)
    return table.concat(ev, "\n")
  end

  ev[#ev + 1] = text_ev(7, HUD_X + 44, HUD_Y + 105, 30, C_WHITE, fmt_time(position), true)
  ev[#ev + 1] = text_ev(9, HUD_X + HUD_W - 44, HUD_Y + 105, 30, C_MUTED,
    duration > 0 and ("−" .. fmt_time(duration - position)) or "", false)
  if tech ~= "" then
    ev[#ev + 1] = text_ev(7, HUD_X + 44, HUD_Y + 146, 28, C_MUTED, tech, false)
  end
  local track_x, track_y, track_w, track_h = HUD_X + 44, HUD_Y + 190, HUD_W - 88, 8
  ev[#ev + 1] = rect_ev(track_x, track_y, track_w, track_h, C_DIM, "&H34&")
  if duration > 0 then
    local progress = math.max(0, math.min(1, position / duration))
    local width = math.floor(track_w * progress)
    if width > 0 then ev[#ev + 1] = rect_ev(track_x, track_y, width, track_h, C_AMBER, "&H00&") end
  end
  ev[#ev + 1] = text_ev(7, HUD_X + 44, HUD_Y + 220, 28, C_MUTED, contextual_hints(), false)
  return table.concat(ev, "\n")
end

local function read_stream_state()
  local file = io.open(STREAM_STATE_FILE, "r")
  if not file then return nil end
  local raw = file:read("*a")
  file:close()
  local parsed = utils.parse_json(raw)
  if type(parsed) ~= "table" or parsed.enabled ~= true or parsed.session_id == nil then return nil end
  return parsed
end

local function readiness(candidate)
  if candidate.unavailable == true then return "Unavailable" end
  if candidate.cache == "cached" then return "Ready now" end
  return "May take longer"
end

local function candidate_summary(candidate)
  return table.concat({
    candidate.resolution or "Unknown",
    candidate.hdr or "SDR",
    candidate.codec or "Unknown",
    readiness(candidate),
    candidate.source or "Source",
  }, "  ·  ")
end

local function candidate_detail_lines(candidate)
  local facts = {}
  local function fact(label, value)
    if type(value) == "string" and value ~= "" then facts[#facts + 1] = label .. "  " .. value end
  end
  fact("Provider", candidate.source)
  fact("Size", candidate.size)
  fact("Bitrate", candidate.bitrate)
  fact("Release", candidate.release_group)
  fact("Audio", candidate.audio)
  fact("Codec", candidate.codec)
  local explanation
  if candidate.unavailable == true then
    explanation = candidate.risk or "This stream did not pass the isolated playback check."
  elseif candidate.capability_class == "known_risky" then
    explanation = candidate.risk or "This stream may exceed the current device playback path."
  elseif candidate.capability_class == "proven_smooth" then
    explanation = "Proven compatible with this device and display path."
  elseif candidate.cache == "cached" then
    explanation = "Available immediately; compatibility is checked before switching."
  else
    explanation = "May need preparation; compatibility is checked before switching."
  end
  return facts, explanation
end

local function clamp_stream_index()
  local candidates = stream_state and stream_state.candidates or {}
  if #candidates == 0 then stream_index = 1 return end
  stream_index = math.max(1, math.min(#candidates, stream_index))
end

local function initial_stream_focus()
  local candidates = stream_state and stream_state.candidates or {}
  if stream_state and stream_state.focus_candidate_id then
    for index, candidate in ipairs(candidates) do
      if candidate.candidate_id == stream_state.focus_candidate_id then return index end
    end
  end
  for index, candidate in ipairs(candidates) do
    if candidate.current ~= true and candidate.unavailable ~= true then return index end
  end
  return 1
end

local function build_streams_ass()
  local candidates = stream_state and stream_state.candidates or {}
  local status = stream_state and stream_state.status or "idle"
  local ev = {}
  -- Local stepped scrim: video above the drawer stays visible and undimmed.
  ev[#ev + 1] = rect_ev(0, DRAWER_Y - 56, CANVAS_W, 56, C_BLACK, "&HD8&")
  ev[#ev + 1] = rect_ev(0, DRAWER_Y - 34, CANVAS_W, 34, C_BLACK, "&HB8&")
  ev[#ev + 1] = rect_ev(0, DRAWER_Y - 16, CANVAS_W, 16, C_BLACK, "&H80&")
  ev[#ev + 1] = rect_ev(0, DRAWER_Y, CANVAS_W, DRAWER_H, C_CHARCOAL, "&H08&")
  ev[#ev + 1] = text_ev(7, SAFE_X + 24, DRAWER_Y + 34, 40, C_WHITE, "Streams", true)
  local status_copy = status == "checking" and "Checking stream…"
    or status == "switching" and "Starting stream…"
    or status == "failed" and "Playback stopped"
    or "Choose a stream"
  ev[#ev + 1] = text_ev(9, CANVAS_W - SAFE_X - 24, DRAWER_Y + 42, 28, C_MUTED, status_copy, false)

  local list_x, list_y, list_w, row_h = 120, DRAWER_Y + 104, 1000, 76
  local detail_x, detail_y = 1180, DRAWER_Y + 112
  if #candidates <= 1 then
    ev[#ev + 1] = text_ev(7, list_x, list_y + 30, 34, C_WHITE, "No alternate streams", true)
    ev[#ev + 1] = text_ev(7, list_x, list_y + 84, 28, C_MUTED,
      "The current title has no other playable sources right now.", false)
    if #candidates == 1 then
      ev[#ev + 1] = text_ev(7, list_x, list_y + 148, 28, C_AMBER,
        "✓  Playing  ·  " .. utf8_prefix(candidate_summary(candidates[1]), 62), true)
    end
  else
    for index, candidate in ipairs(candidates) do
      local y = list_y + (index - 1) * row_h
      local focused = index == stream_index
      if focused then
        ev[#ev + 1] = rect_ev(list_x - 4, y - 4, list_w + 8, row_h - 4, C_WHITE, "&H00&")
      end
      ev[#ev + 1] = rect_ev(list_x, y, list_w, row_h - 12,
        candidate.current == true and C_ROW_CURRENT or C_ROW, candidate.unavailable == true and "&H48&" or "&H12&")
      local colour = candidate.unavailable == true and C_DIM or C_WHITE
      local marker = candidate.current == true and "✓  " or candidate.unavailable == true and "×  " or "   "
      ev[#ev + 1] = text_ev(7, list_x + 22, y + 18, 28,
        candidate.current == true and C_AMBER or colour,
        marker .. utf8_prefix(candidate_summary(candidate), 70), candidate.current == true)
      if candidate.current == true then
        ev[#ev + 1] = text_ev(9, list_x + list_w - 20, y + 20, 26, C_AMBER, "Playing", true)
      end
    end
  end

  local focused = candidates[stream_index]
  if focused and #candidates > 1 then
    ev[#ev + 1] = text_ev(7, detail_x, detail_y, 34, C_WHITE,
      focused.source or "Stream details", true)
    ev[#ev + 1] = text_ev(7, detail_x, detail_y + 48, 28,
      focused.unavailable == true and C_ERROR or C_MUTED, readiness(focused), true)
    if focused.capability_class == "known_risky" and focused.unavailable ~= true then
      ev[#ev + 1] = text_ev(7, detail_x, detail_y + 90, 28, C_ERROR,
        "May stutter on this device", true)
    end
    local facts, explanation = candidate_detail_lines(focused)
    local fact_y = detail_y + (focused.capability_class == "known_risky" and 142 or 100)
    for _, line in ipairs(facts) do
      ev[#ev + 1] = text_ev(7, detail_x, fact_y, 26, C_MUTED, utf8_prefix(line, 38), false)
      fact_y = fact_y + 38
    end
    ev[#ev + 1] = text_ev(7, detail_x, math.min(fact_y + 16, DRAWER_Y + 456), 26,
      focused.unavailable == true and C_ERROR or C_WHITE, utf8_prefix(explanation, 42), false)
  elseif #candidates == 1 then
    ev[#ev + 1] = text_ev(7, detail_x, detail_y, 34, C_WHITE, "No alternatives", true)
    ev[#ev + 1] = text_ev(7, detail_x, detail_y + 58, 28, C_MUTED,
      "The current stream is the only source available.", false)
  end

  if stream_state and type(stream_state.error) == "string" and stream_state.error ~= "" then
    ev[#ev + 1] = rect_ev(SAFE_X, CANVAS_H - 106, CANVAS_W - SAFE_X * 2, 52, C_ERROR, "&H14&")
    ev[#ev + 1] = text_ev(5, CANVAS_W / 2, CANVAS_H - 80, 28, C_WHITE,
      utf8_prefix(stream_state.error, 96), true)
  else
    ev[#ev + 1] = text_ev(9, CANVAS_W - SAFE_X, CANVAS_H - 70, 26, C_MUTED,
      "↑/↓  Choose     B  Select     Y  Close", false)
  end
  return table.concat(ev, "\n")
end

local function build_badge_ass(label, colour)
  local width = math.max(220, #label * 20 + 72)
  local x = math.floor((CANVAS_W - width) / 2)
  local y = math.floor(CANVAS_H / 2) - 42
  local function fade_in(event)
    return event:gsub("^%{", "{\\fad(180,0)", 1)
  end
  return table.concat({
    fade_in(rect_ev(x, y, width, 84, C_CHARCOAL, "&H10&")),
    fade_in(text_ev(5, CANVAS_W / 2, y + 42, 38, colour or C_WHITE, label, true)),
  }, "\n")
end

local function build_ass()
  if overlay_mode == "streams" then return build_streams_ass() end
  if overlay_mode == "buffering" then return build_badge_ass("Buffering…", C_WHITE) end
  if overlay_mode == "pause_badge" then return build_badge_ass("Paused", C_WHITE) end
  if overlay_mode == "hud" or overlay_mode == "confirmation" then return build_hud_ass() end
  return ""
end

render = function()
  if overlay_mode == "hidden" then overlay:remove() return end
  overlay.data = build_ass()
  overlay:update()
end

local function stop_hud_timers()
  hide_timer = stop_timer(hide_timer)
  tick_timer = stop_timer(tick_timer)
end

local function settle_after_hud()
  stop_hud_timers()
  visible = false
  if buffering then
    overlay_mode = "buffering"
  elseif mp.get_property_native("pause") == true then
    overlay_mode = "pause_badge"
  else
    overlay_mode = "hidden"
  end
  write_visible_state(false, overlay_mode)
  render()
end

local function show_hud(reason, forced_seconds)
  if overlay_mode == "streams" then return end
  hud_reason = reason or "show"
  local _, adaptive = current_action(hud_reason)
  local seconds = forced_seconds or adaptive
  overlay_mode = hud_reason == "confirmation" and "confirmation" or "hud"
  visible = true
  write_visible_state(true, overlay_mode)
  render()
  stop_hud_timers()
  tick_timer = mp.add_periodic_timer(1.0, render)
  hide_timer = mp.add_timeout(seconds, settle_after_hud)
end

local function close_streams()
  stream_poll_timer = stop_timer(stream_poll_timer)
  request_pending = false
  stream_state = nil
  stream_index = 1
  settle_after_hud()
end

local function refresh_stream_state()
  local focused_id = stream_state and stream_state.candidates
    and stream_state.candidates[stream_index]
    and stream_state.candidates[stream_index].candidate_id or nil
  local next_state = read_stream_state()
  if next_state then
    stream_state = next_state
    request_pending = next_state.status == "checking" or next_state.status == "switching"
    if focused_id then
      for index, candidate in ipairs(stream_state.candidates or {}) do
        if candidate.candidate_id == focused_id then stream_index = index break end
      end
    end
    clamp_stream_index()
    if overlay_mode == "streams" then render() end
  end
end

local function open_streams()
  if not x_supported() then return end
  stream_state = read_stream_state()
  if not stream_state then return end
  stop_hud_timers()
  overlay_mode = "streams"
  visible = true
  request_pending = stream_state.status == "checking" or stream_state.status == "switching"
  stream_index = initial_stream_focus()
  stream_poll_timer = stop_timer(stream_poll_timer)
  stream_poll_timer = mp.add_periodic_timer(1.0, refresh_stream_state)
  write_visible_state(true, "streams")
  render()
end

local function show_request_error(message)
  PLAYBACK_TITLE = message
  PLAYBACK_CONTEXT = ""
  show_hud("show", LONG_SEC)
end

local function post_stream_action(body, callback)
  local payload = utils.format_json(body)
  mp.command_native_async({
    name = "subprocess",
    playback_only = false,
    capture_stdout = true,
    capture_stderr = true,
    args = {
      "curl", "-sS", "--max-time", "4", "-f",
      "-H", "content-type: application/json",
      "--data", payload,
      CATALOG_URL .. "/play-session/active/streams/switch",
    },
  }, function(success, result)
    request_pending = false
    local parsed = type(result) == "table" and type(result.stdout) == "string"
      and utils.parse_json(result.stdout) or nil
    if type(parsed) == "table" and type(parsed.streams) == "table" then
      stream_state = parsed.streams
    end
    if callback then callback(success == true) end
    if overlay_mode == "streams" then refresh_stream_state() end
  end)
end

local function try_confirmation_undo()
  local state = read_stream_state()
  local now_ms = os.time() * 1000
  if not state or not state.switch_undo_candidate_id or not state.switch_confirmed_at
    or now_ms - tonumber(state.switch_confirmed_at) > 9000 then
    return false
  end
  request_pending = true
  post_stream_action({
    session_id = state.session_id,
    revision = state.revision,
    candidate_id = state.switch_undo_candidate_id,
    undo = true,
  }, function(ok)
    if not ok then show_request_error("Could not restore the previous stream") end
  end)
  return true
end

mp.register_script_message("mango-hud-show", function(reason)
  show_hud(reason or "show")
end)

mp.register_script_message("mango-hud-hide", settle_after_hud)

mp.register_script_message("mango-streams-toggle", function()
  if not x_supported() or request_pending then return end
  if overlay_mode == "streams" then close_streams() return end
  if overlay_mode == "confirmation" and mp.get_time() <= confirmation_until
    and try_confirmation_undo() then return end
  open_streams()
end)

mp.register_script_message("mango-streams-close", function()
  if overlay_mode == "streams" then close_streams() end
end)

mp.register_script_message("mango-streams-move", function(delta)
  if overlay_mode ~= "streams" or request_pending or not stream_state then return end
  local candidates = stream_state.candidates or {}
  if #candidates == 0 then return end
  stream_index = ((stream_index - 1 + (tonumber(delta) or 0)) % #candidates) + 1
  render()
end)

mp.register_script_message("mango-streams-select", function()
  if overlay_mode ~= "streams" or request_pending or not stream_state then return end
  local selected = (stream_state.candidates or {})[stream_index]
  if not selected or selected.current == true or selected.unavailable == true then return end
  request_pending = true
  stream_state.status = "checking"
  stream_state.error = nil
  render()
  post_stream_action({
    session_id = stream_state.session_id,
    revision = stream_state.revision,
    candidate_id = selected.candidate_id,
  }, function(ok)
    if not ok and overlay_mode == "streams" then
      stream_state.status = "ready"
      stream_state.error = "Could not check that stream. The current video is still playing."
      render()
    end
  end)
end)

mp.observe_property("paused-for-cache", "bool", function(_, paused_for_cache)
  buffering_timer = stop_timer(buffering_timer)
  if paused_for_cache == true then
    buffering_timer = mp.add_timeout(1.0, function()
      buffering_timer = nil
      if mp.get_property_native("paused-for-cache") == true and overlay_mode ~= "streams" then
        buffering = true
        overlay_mode = "buffering"
        visible = false
        write_visible_state(false, "buffering")
        render()
      end
    end)
  elseif buffering then
    buffering = false
    if mp.get_property_native("pause") == true then
      overlay_mode = "pause_badge"
    else
      overlay_mode = "hidden"
    end
    write_visible_state(false, overlay_mode)
    render()
  end
end)

mp.observe_property("pause", "bool", function(_, paused)
  if overlay_mode == "streams" or overlay_mode == "hud" or overlay_mode == "confirmation"
    or overlay_mode == "buffering" then return end
  overlay_mode = paused == true and "pause_badge" or "hidden"
  write_visible_state(false, overlay_mode)
  render()
end)

local function fixture_streams(state)
  return {
    enabled = true, session_id = "fixture", revision = 3, status = state or "ready",
    current_candidate_id = "current", error = state == "failed"
      and "That stream is unavailable. The current video is still playing." or nil,
    candidates = {
      { candidate_id="current", current=true, unavailable=false, resolution="4K", hdr="HDR", codec="HEVC", cache="cached", source="TorBox", size="18.4 GB", bitrate="24.0 Mbps", release_group="MANGO", audio="English 5.1", capability_class="proven_smooth" },
      { candidate_id="best", current=false, unavailable=false, resolution="1080p", hdr="SDR", codec="AVC", cache="cached", source="Real-Debrid", size="7.1 GB", bitrate="8.6 Mbps", release_group="WEB", audio="English 5.1", capability_class="proven_smooth" },
      { candidate_id="slow", current=false, unavailable=false, resolution="4K", hdr="SDR", codec="HEVC", cache="uncached", source="TorBox", size="21 GB", bitrate=nil, release_group="REMUX", audio="Hindi 5.1", capability_class="unknown" },
      { candidate_id="risky", current=false, unavailable=false, resolution="4K", hdr="HDR", codec="HEVC", cache="cached", source="AIOStreams", size="42 GB", bitrate="70 Mbps", release_group="REMUX", audio="English 7.1", capability_class="known_risky", risk="Observed bitrate exceeds the proven device path." },
      { candidate_id="bad", current=false, unavailable=true, resolution="720p", hdr="SDR", codec="AVC", cache="unknown", source="AIOStreams", size=nil, bitrate=nil, release_group=nil, audio="English", capability_class="unknown", risk="The isolated playback check did not start." },
    },
  }
end

if FIXTURES then
  mp.register_script_message("mango-hud-fixture", function(name)
    fixture_name = name
    if name == "paused" then overlay_mode = "pause_badge"
    elseif name == "buffering" then overlay_mode = "buffering"
    elseif name == "seek" then hud_reason = "seek:-10"; overlay_mode = "hud"
    elseif name == "volume" then hud_reason = "volume"; overlay_mode = "hud"
    elseif name == "live" then hud_reason = "show"; overlay_mode = "hud"
    elseif name == "confirmation" then
      hud_reason = "show"
      PLAYBACK_TITLE = "Now playing · 1080p · Ready now"
      PLAYBACK_CONTEXT = ""
      overlay_mode = "confirmation"
    elseif name:find("streams", 1, true) then
      stream_state = fixture_streams(name == "streams-checking" and "checking" or name == "streams-failed" and "failed" or "ready")
      stream_index = name == "streams-risky" and 4 or name == "streams-unavailable" and 5 or 2
      overlay_mode = "streams"
    else hud_reason = "show"; overlay_mode = "hud" end
    render()
  end)
end

if START_CONFIRMATION ~= "" then
  PLAYBACK_TITLE = START_CONFIRMATION
  PLAYBACK_CONTEXT = ""
  hud_reason = "show"
  overlay_mode = "confirmation"
  visible = true
  confirmation_until = mp.get_time() + LONG_SEC
  write_visible_state(true, "confirmation")
  render()
  hide_timer = mp.add_timeout(LONG_SEC, settle_after_hud)
elseif START_REOPEN_STREAMS then
  mp.add_timeout(1.0, open_streams)
end

mp.register_event("shutdown", function()
  pcall(write_visible_state, false, "hidden")
end)
