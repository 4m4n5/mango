-- Mango cinematic playback HUD and in-player Streams sheet.
--
-- Everything is drawn into mpv's libass overlay. Keeping one fullscreen window
-- preserves the Pi's direct-scanout path; the legacy Tk overlay remains a
-- rollback-only backend. The script is idle until controller interaction, a
-- real buffering event, a pause badge, or a post-switch confirmation requires
-- chrome.
--
-- The card has three jobs: identity (title, volume), transport (time and
-- progress), and A/V literacy. Equal Subtitles / Audio / Quality chips name
-- the control and its current state. The footer legend lists every primary
-- pad mapping. Button glyphs never replace those nouns. The title never
-- changes to describe a track, volume, or quality event.

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
local HUD_X, HUD_Y, HUD_W, HUD_H = 160, 728, 1600, 292
local SHEET_X, SHEET_Y, SHEET_W, SHEET_H = 160, 228, 1600, 780
local CARD_RADIUS = 16
local CHIP_RADIUS = 14
local PAD = 40
local TRACK_H = 4
local PLAYHEAD_W = 8
local PLAYHEAD_H = 12
local CHIP_H = 64
local CHIP_GAP = 16
local CHIP_MIN_W = 276
local CHIP_PAD_X = 22
local VOL_TICKS = 10
local VOL_TICK_W = 5
local VOL_TICK_G = 3
local VOL_TICK_H = 14

-- ASS uses BBGGRR and 00..FF alpha (00 opaque).
local C_PRIMARY = "&H00EAF1F4&" -- #F4F1EA
local C_SECONDARY = "&H00818586&"
local C_CAPTION = "&H00595C5D&"
local C_CARD = "&H000E0C0B&" -- #0B0C0E
local C_WHITE = "&H00FFFFFF&"
local C_ACCENT = "&H0020A0E8&" -- Mango #e8a020, state only
local C_ERROR = "&H00656AEB&"
local C_INK = "&H000E0C0B&"
local C_BLACK = "&H00000000&"
local A_CARD = "&H5C&"
local A_PILL = "&HE8&"
local A_PILL_ON = "&H22&"
local A_TRACK = "&HC0&"
local A_TICK_OFF = "&HC8&"
local A_FOCUS = "&HEB&"
local A_SCRIM = { "&HD8&", "&HB8&", "&H90&" }

local overlay = mp.create_osd_overlay("ass-events")
overlay.res_x = CANVAS_W
overlay.res_y = CANVAS_H
overlay.z = 10
overlay.hidden = true

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
local confirmation_copy = ""
local fixture_name = nil
local render

local LANG_NAMES = {
  en = "English", eng = "English", hi = "Hindi", hin = "Hindi",
  es = "Spanish", spa = "Spanish", fr = "French", fre = "French", fra = "French",
  de = "German", ger = "German", deu = "German", ja = "Japanese", jp = "Japanese",
  ko = "Korean", zh = "Chinese", chi = "Chinese", zho = "Chinese",
  ta = "Tamil", te = "Telugu", ml = "Malayalam", kn = "Kannada",
  mr = "Marathi", bn = "Bengali", pa = "Punjabi", ur = "Urdu",
  it = "Italian", pt = "Portuguese", ru = "Russian", ar = "Arabic",
}

local function trim(value)
  return (tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function clean_text(value)
  return trim(tostring(value or ""):gsub("[%z\1-\31\127]", " "):gsub("%s+", " "))
end

local function utf8_len(value)
  local text = clean_text(value)
  local index, count = 1, 0
  while index <= #text do
    local byte = text:byte(index)
    local width = byte < 0x80 and 1 or byte < 0xE0 and 2 or byte < 0xF0 and 3 or 4
    if index + width - 1 > #text then break end
    index = index + width
    count = count + 1
  end
  return count
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

local function text_ev(an, x, y, size, colour, text, bold, extra)
  return string.format(
    "{\\an%d\\pos(%d,%d)\\fnDejaVu Sans\\fs%d\\1c%s\\bord0\\shad0%s%s\\q2}%s",
    an, x, y, size, colour, bold and "\\b1" or "", extra or "", ass_escape(text)
  )
end

local function rect_ev(x, y, width, height, colour, alpha)
  return string.format(
    "{\\an7\\pos(%d,%d)\\1c%s\\1a%s\\bord0\\shad0\\p1}m 0 0 l %d 0 %d %d 0 %d{\\p0}",
    x, y, colour, alpha or "&H00&", width, width, height, height
  )
end

-- One closed cubic path. Compositing discs onto a translucent rect reads as
-- random circles at the corners because overlapping alpha darkens twice.
local function rounded_rect(x, y, w, h, r, colour, alpha)
  r = math.max(1, math.min(r, math.floor(math.min(w, h) / 2)))
  local k = math.max(1, math.floor(r * 0.552 + 0.5))
  local wr, hr = w - r, h - r
  local path = table.concat({
    string.format("m %d 0", r),
    string.format("l %d 0", wr),
    string.format("b %d 0 %d %d %d %d", wr + k, w, r - k, w, r),
    string.format("l %d %d", w, hr),
    string.format("b %d %d %d %d %d %d", w, hr + k, wr + k, h, wr, h),
    string.format("l %d %d", r, h),
    string.format("b %d %d 0 %d 0 %d", r - k, h, hr + k, hr),
    string.format("l 0 %d", r),
    string.format("b 0 %d %d 0 %d 0", r - k, r - k, r),
  }, " ")
  return string.format(
    "{\\an7\\pos(%d,%d)\\1c%s\\1a%s\\bord0\\shad0\\p1}%s{\\p0}",
    x, y, colour, alpha or "&H00&", path
  )
end

local function control_width(noun, value)
  return math.max(
    CHIP_MIN_W,
    utf8_len(noun) * 10 + CHIP_PAD_X * 2,
    utf8_len(value) * 14 + CHIP_PAD_X * 2
  )
end

-- Two-line status chip: the noun names the control, the value names the state.
-- Button glyphs belong in the footer legend, not here. Sibling chips share
-- one width so the A/V row reads as a single instrument, not mixed pills.
local function draw_control(x, y, noun, value, active, width)
  width = width or control_width(noun, value)
  local fill = active and rounded_rect(x, y, width, CHIP_H, CHIP_RADIUS, C_ACCENT, A_PILL_ON)
    or rounded_rect(x, y, width, CHIP_H, CHIP_RADIUS, C_WHITE, A_PILL)
  local noun_colour = active and C_INK or C_CAPTION
  local value_colour = active and C_INK or C_PRIMARY
  return table.concat({
    fill,
    text_ev(7, x + CHIP_PAD_X, y + 10, 16, noun_colour, noun, false, "\\fsp1"),
    text_ev(7, x + CHIP_PAD_X, y + 32, 24, value_colour, value, true),
  }, "\n"), width
end

local function draw_live_mark(right, cy)
  local width, height = 68, 28
  local x = right - width
  local y = cy - math.floor(height / 2)
  return table.concat({
    rounded_rect(x, y, width, height, 8, C_WHITE, A_PILL),
    text_ev(5, x + math.floor(width / 2), cy, 15, C_PRIMARY, "LIVE", true, "\\fsp1.5"),
  }, "\n"), x
end

local function draw_legend(cx, y, items, active_label)
  if #items == 0 then return "" end
  local key_gap, cluster_gap = 8, 48
  local key_advance = 16
  local widths = {}
  local total = 0
  for index, item in ipairs(items) do
    local width = utf8_len(item.key) * key_advance + key_gap + utf8_len(item.label) * 12
    widths[index] = width
    total = total + width
    if index > 1 then total = total + cluster_gap end
  end
  local max_w = HUD_W - PAD * 2
  if total > max_w and #items > 1 then
    cluster_gap = math.max(16, cluster_gap - math.ceil((total - max_w) / (#items - 1)))
    total = 0
    for index, width in ipairs(widths) do
      total = total + width
      if index > 1 then total = total + cluster_gap end
    end
  end
  local x = cx - math.floor(total / 2)
  local ev = {}
  for index, item in ipairs(items) do
    local focused = active_label ~= nil and item.label == active_label
    ev[#ev + 1] = text_ev(7, x, y, 22, focused and C_PRIMARY or C_SECONDARY, item.key, true)
    ev[#ev + 1] = text_ev(
      7, x + utf8_len(item.key) * key_advance + key_gap, y, 22,
      focused and C_PRIMARY or C_CAPTION, item.label, focused == true)
    x = x + widths[index] + cluster_gap
  end
  return table.concat(ev, "\n")
end

local function write_visible_state(is_visible, state_mode, seconds)
  local dwell = seconds
  if dwell == nil then
    dwell = is_visible and NORMAL_SEC or 0
  end
  local payload = string.format(
    '{"visible":%s,"mode":"%s","ts":%d,"visible_sec":%.1f}\n',
    is_visible and "true" or "false",
    state_mode or overlay_mode,
    os.time(),
    dwell
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

local function tracks_of(track_type)
  local found = {}
  local tracks = mp.get_property_native("track-list")
  if type(tracks) ~= "table" then return found end
  for _, track in ipairs(tracks) do
    if type(track) == "table" and track.type == track_type then
      found[#found + 1] = track
    end
  end
  return found
end

local function selected_track(track_type)
  local property = track_type == "audio" and "aid" or "sid"
  local selected = mp.get_property_native(property)
  if not track_active(selected) then return nil end
  local tracks = tracks_of(track_type)
  for _, track in ipairs(tracks) do
    if tonumber(track.id) == tonumber(selected) then return track end
  end
  return nil
end

local function language_name(track)
  if type(track) ~= "table" then return nil end
  local code = clean_text(track.lang):lower()
  if code ~= "" and LANG_NAMES[code] then return LANG_NAMES[code] end
  local title = clean_text(track.title)
  if title ~= "" then return title end
  if code ~= "" then return code:upper() end
  return nil
end

local function channel_label()
  local channels = clean_text(mp.get_property_native("audio-params/hr-channels"))
  if channels == "" then
    local count = tonumber(mp.get_property_native("audio-params/channel-count"))
    if count == 2 then return "Stereo" end
    if count then return string.format("%g ch", count) end
    return nil
  end
  if channels == "stereo" then return "Stereo" end
  return channels:upper()
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
  return nil
end

local function display_title()
  local title = clean_text(PLAYBACK_TITLE)
  local context = clean_text(PLAYBACK_CONTEXT)
  if title == "" then title = "Playing" end
  if context ~= "" then title = title .. " · " .. context end
  return utf8_prefix(title, 52)
end

local function identity_title()
  if tostring(hud_reason) == "error" then return "Playback needs attention" end
  return display_title()
end

local function dwell_seconds(reason)
  reason = tostring(reason or "show")
  if reason == "subs" or reason == "audio" or reason == "error"
    or reason == "confirmation" then
    return LONG_SEC
  end
  return NORMAL_SEC
end

local function x_supported()
  return PLAYBACK_KIND ~= "tv" and PLAYBACK_KIND ~= "youtube_video"
end

local function is_live()
  if fixture_name == "live" then return true end
  return PLAYBACK_KIND == "tv"
end

local function track_ordinal(track_type, track)
  local tracks = tracks_of(track_type)
  if #tracks < 2 or type(track) ~= "table" then return nil end
  for index, candidate in ipairs(tracks) do
    if tonumber(candidate.id) == tonumber(track.id) then
      return string.format("%d of %d", index, #tracks)
    end
  end
  return nil
end

local function named_track_value(track_type, track)
  local language = language_name(track)
  if language then return language end
  local tracks = tracks_of(track_type)
  if type(track) == "table" then
    for index, candidate in ipairs(tracks) do
      if tonumber(candidate.id) == tonumber(track.id) then
        return string.format("Track %d", index)
      end
    end
  end
  if #tracks > 0 then return "Track 1" end
  return nil
end

local function fixture_tracks()
  if not FIXTURES then return nil end
  if fixture_name == "live" then
    return { subs = nil, audio = "English", quality = "1080p" }
  end
  if fixture_name == "subs-off" then
    return { subs = "Off", audio = "Hindi · 5.1", quality = "1080p" }
  end
  return { subs = "English", audio = "Hindi · 5.1", quality = "4K HDR" }
end

local function subtitle_control()
  local stub = fixture_tracks()
  if stub then
    if stub.subs == nil then return nil end
    return stub.subs
  end
  if #tracks_of("sub") == 0 then return nil end
  if mp.get_property_native("sub-visibility") ~= true then return "Off" end
  local track = selected_track("sub")
  if not track then return "Off" end
  local value = named_track_value("sub", track) or "Off"
  if tostring(hud_reason) == "subs" then
    local ordinal = track_ordinal("sub", track)
    if ordinal then value = value .. "  ·  " .. ordinal end
  end
  return utf8_prefix(value, 18)
end

local function audio_control()
  local stub = fixture_tracks()
  if stub then
    if stub.audio == nil then return nil end
    return stub.audio
  end
  local track = selected_track("audio")
  if #tracks_of("audio") == 0 and not track then return nil end
  local pieces = {}
  local language = named_track_value("audio", track)
  if language then pieces[#pieces + 1] = language end
  local channels = channel_label()
  if channels then pieces[#pieces + 1] = channels end
  if #pieces == 0 then pieces[1] = "Default" end
  local value = table.concat(pieces, "  ·  ")
  if tostring(hud_reason) == "audio" then
    local ordinal = track_ordinal("audio", track)
    if ordinal then value = value .. "  ·  " .. ordinal end
  end
  return utf8_prefix(value, 22)
end

local function quality_control()
  local stub = fixture_tracks()
  if stub then return stub.quality end
  local resolution = resolution_label()
  if not resolution then return nil end
  if hdr_label() then return resolution .. " HDR" end
  return resolution
end

local function quality_is_active()
  return overlay_mode == "confirmation" or confirmation_copy ~= ""
end

local function hud_chips()
  local chips = {}
  local subs = subtitle_control()
  if subs then
    chips[#chips + 1] = {
      noun = "Subtitles",
      value = subs,
      active = tostring(hud_reason) == "subs",
    }
  end
  local audio = audio_control()
  if audio then
    chips[#chips + 1] = {
      noun = "Audio",
      value = audio,
      active = tostring(hud_reason) == "audio",
    }
  end
  local quality = quality_control()
  if quality then
    chips[#chips + 1] = {
      noun = "Quality",
      value = quality,
      active = quality_is_active(),
    }
  end
  return chips
end

local function matching_chip_width(chips)
  local width = CHIP_MIN_W
  for _, chip in ipairs(chips) do
    width = math.max(width, control_width(chip.noun, chip.value))
  end
  return width
end

local function legend_items()
  local paused = mp.get_property_native("pause") == true
  local items = {}
  if not is_live() then items[#items + 1] = { key = "←→", label = "Skip" } end
  if subtitle_control() then items[#items + 1] = { key = "↑", label = "Subtitles" } end
  if audio_control() then items[#items + 1] = { key = "A", label = "Audio" } end
  items[#items + 1] = { key = "−+", label = "Volume" }
  items[#items + 1] = { key = "B", label = paused and "Resume" or "Pause" }
  if confirmation_copy ~= "" then
    items[#items + 1] = { key = "X", label = "Undo" }
  elseif x_supported() then
    items[#items + 1] = { key = "X", label = "Streams" }
  end
  items[#items + 1] = { key = "Y", label = "Back" }
  return items
end

local function legend_active_label()
  local reason = tostring(hud_reason or "")
  if reason == "subs" then return "Subtitles" end
  if reason == "audio" then return "Audio" end
  if reason == "volume" then return "Volume" end
  if reason == "pause" then return "Resume" end
  if reason == "resume" then return "Pause" end
  if reason == "confirmation" then return "Undo" end
  if reason:find("seek", 1, true) or reason == "left" or reason == "right" then
    return "Skip"
  end
  return nil
end

local function volume_percent()
  if FIXTURES then
    if fixture_name == "volume" then return 45 end
    return 32
  end
  local volume = mp.get_property_number("volume")
  if volume == nil then return 0 end
  local vmax = mp.get_property_number("volume-max") or 100
  if vmax < 1 then vmax = 100 end
  return math.max(0, math.min(100, math.floor(volume / vmax * 100 + 0.5)))
end

local function draw_volume(right, cy, active)
  local level = volume_percent()
  local label = tostring(level)
  local meter_w = VOL_TICKS * VOL_TICK_W + (VOL_TICKS - 1) * VOL_TICK_G
  local label_w = math.max(24, utf8_len(label) * 13)
  local glyph_w = 16
  local ev = {
    text_ev(6, right, cy, 22, active and C_PRIMARY or C_SECONDARY, label, active == true),
  }
  local plus_x = right - label_w - 14
  local meter_right = plus_x - glyph_w - 6
  local meter_left = meter_right - meter_w
  local minus_x = meter_left - 10
  local glyph_colour = active and C_PRIMARY or C_CAPTION
  ev[#ev + 1] = text_ev(6, plus_x, cy, 18, glyph_colour, "+", false)
  ev[#ev + 1] = text_ev(6, minus_x, cy, 18, glyph_colour, "−", false)
  local filled = math.floor((level / 100) * VOL_TICKS + 0.499)
  local tick_y = cy - math.floor(VOL_TICK_H / 2)
  for index = 1, VOL_TICKS do
    local x = meter_left + (index - 1) * (VOL_TICK_W + VOL_TICK_G)
    if index <= filled then
      ev[#ev + 1] = rect_ev(x, tick_y, VOL_TICK_W, VOL_TICK_H, active and C_ACCENT or C_PRIMARY, "&H00&")
    else
      ev[#ev + 1] = rect_ev(x, tick_y, VOL_TICK_W, VOL_TICK_H, C_WHITE, A_TICK_OFF)
    end
  end
  return table.concat(ev, "\n"), minus_x - 18
end

local function seek_transient()
  local reason = tostring(hud_reason or "")
  local seek = reason:match("^seek:([+-]?%d+)$")
  if seek then
    local amount = tonumber(seek) or 0
    return string.format("%s%ds", amount < 0 and "−" or "+", math.abs(amount))
  end
  if reason == "left" then return "−10s" end
  if reason == "right" then return "+10s" end
  return nil
end

local function seeking()
  return seek_transient() ~= nil
end

local function build_hud_ass()
  local position = mp.get_property_number("time-pos") or 0
  local duration = mp.get_property_number("duration") or 0
  local live = is_live()
  local ev = {}
  ev[#ev + 1] = rounded_rect(HUD_X, HUD_Y, HUD_W, HUD_H, CARD_RADIUS, C_CARD, A_CARD)

  local left = HUD_X + PAD
  local right = HUD_X + HUD_W - PAD
  local title_y = HUD_Y + 26
  local volume_active = tostring(hud_reason) == "volume"
  local volume_ass, volume_left = draw_volume(right, title_y + 16, volume_active)
  ev[#ev + 1] = text_ev(7, left, title_y, 28, C_PRIMARY, identity_title(), false)
  ev[#ev + 1] = volume_ass
  if live then
    local live_ass, _ = draw_live_mark(volume_left - 18, title_y + 16)
    ev[#ev + 1] = live_ass
  end

  if overlay_mode == "confirmation" or confirmation_copy ~= "" then
    ev[#ev + 1] = text_ev(7, left, title_y + 38, 18, C_CAPTION,
      utf8_prefix(confirmation_copy ~= "" and confirmation_copy or "Now playing", 42), false)
  end

  local track_left = left + 96
  local track_right = right - 96
  local chip_y = HUD_Y + 146
  if not live then
    local transport_y = HUD_Y + 98
    ev[#ev + 1] = text_ev(7, left, transport_y, 24, C_PRIMARY, fmt_time(position), false)
    local remaining = duration > 0 and ("−" .. fmt_time(duration - position)) or ""
    local delta = seek_transient()
    if delta then remaining = remaining ~= "" and (delta .. "  " .. remaining) or delta end
    ev[#ev + 1] = text_ev(9, right, transport_y, 22, seeking() and C_ACCENT or C_SECONDARY,
      remaining, seeking())
    local track_w = math.max(80, track_right - track_left)
    local track_y = transport_y - math.floor(TRACK_H / 2)
    ev[#ev + 1] = rect_ev(track_left, track_y, track_w, TRACK_H, C_WHITE, A_TRACK)
    if duration > 0 then
      local progress = math.max(0, math.min(1, position / duration))
      local fill_w = math.max(progress > 0 and PLAYHEAD_W or 0, math.floor(track_w * progress))
      ev[#ev + 1] = rect_ev(track_left, track_y, fill_w, TRACK_H,
        seeking() and C_ACCENT or C_PRIMARY, "&H00&")
      local head_x = track_left + math.max(0, fill_w - PLAYHEAD_W)
      local head_y = track_y - math.floor((PLAYHEAD_H - TRACK_H) / 2)
      ev[#ev + 1] = rect_ev(head_x, head_y, PLAYHEAD_W, PLAYHEAD_H,
        seeking() and C_ACCENT or C_PRIMARY, "&H00&")
    end
  else
    chip_y = HUD_Y + 104
  end

  local chips = hud_chips()
  local chip_width = matching_chip_width(chips)
  local chip_x = left
  for _, chip in ipairs(chips) do
    local drawn, width = draw_control(
      chip_x, chip_y, chip.noun, chip.value, chip.active, chip_width)
    ev[#ev + 1] = drawn
    chip_x = chip_x + width + CHIP_GAP
  end

  ev[#ev + 1] = draw_legend(
    HUD_X + math.floor(HUD_W / 2),
    HUD_Y + HUD_H - 40,
    legend_items(),
    legend_active_label()
  )
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
  ev[#ev + 1] = rect_ev(0, SHEET_Y - 48, CANVAS_W, 20, C_BLACK, A_SCRIM[1])
  ev[#ev + 1] = rect_ev(0, SHEET_Y - 28, CANVAS_W, 16, C_BLACK, A_SCRIM[2])
  ev[#ev + 1] = rect_ev(0, SHEET_Y - 12, CANVAS_W, 12, C_BLACK, A_SCRIM[3])
  ev[#ev + 1] = rounded_rect(SHEET_X, SHEET_Y, SHEET_W, SHEET_H, CARD_RADIUS, C_CARD, A_CARD)
  ev[#ev + 1] = text_ev(7, SHEET_X + PAD, SHEET_Y + 36, 28, C_PRIMARY, "Streams", false)
  local status_copy = status == "checking" and "Checking stream…"
    or status == "switching" and "Starting stream…"
    or status == "failed" and "Playback stopped"
    or "Choose a stream"
  ev[#ev + 1] = text_ev(9, SHEET_X + SHEET_W - PAD, SHEET_Y + 42, 20, C_CAPTION, status_copy, false)

  local list_x, list_y, list_w, row_h = SHEET_X + PAD, SHEET_Y + 96, 920, 72
  local detail_x, detail_y = SHEET_X + 1000, SHEET_Y + 104
  if #candidates <= 1 then
    ev[#ev + 1] = text_ev(7, list_x, list_y + 24, 28, C_PRIMARY, "No alternate streams", false)
    ev[#ev + 1] = text_ev(7, list_x, list_y + 68, 20, C_CAPTION,
      "The current title has no other playable sources right now.", false)
    if #candidates == 1 then
      ev[#ev + 1] = text_ev(7, list_x, list_y + 120, 20, C_ACCENT,
        "Now  ·  " .. utf8_prefix(candidate_summary(candidates[1]), 62), true)
    end
  else
    for index, candidate in ipairs(candidates) do
      local y = list_y + (index - 1) * row_h
      local focused = index == stream_index
      local unavailable = candidate.unavailable == true
      if focused then
        ev[#ev + 1] = rounded_rect(list_x, y, list_w, row_h - 8, 8, C_WHITE, A_FOCUS)
        ev[#ev + 1] = rect_ev(list_x, y + 8, 3, row_h - 24, C_PRIMARY, "&H00&")
      end
      local colour = unavailable and C_CAPTION or C_PRIMARY
      ev[#ev + 1] = text_ev(7, list_x + 22, y + 22, 22, colour,
        utf8_prefix(candidate_summary(candidate), 58), false)
      if candidate.current == true then
        ev[#ev + 1] = text_ev(9, list_x + list_w - 20, y + 22, 20, C_ACCENT, "Now", true)
      end
    end
  end

  local focused = candidates[stream_index]
  if focused and #candidates > 1 then
    ev[#ev + 1] = text_ev(7, detail_x, detail_y, 28, C_PRIMARY,
      focused.source or "Stream details", false)
    ev[#ev + 1] = text_ev(7, detail_x, detail_y + 40, 20,
      focused.unavailable == true and C_ERROR or C_CAPTION, readiness(focused), false)
    if focused.capability_class == "known_risky" and focused.unavailable ~= true then
      ev[#ev + 1] = text_ev(7, detail_x, detail_y + 72, 20, C_ERROR,
        "May stutter on this device", true)
    end
    local facts, explanation = candidate_detail_lines(focused)
    local fact_y = detail_y + (focused.capability_class == "known_risky" and 112 or 80)
    for _, line in ipairs(facts) do
      ev[#ev + 1] = text_ev(7, detail_x, fact_y, 20, C_CAPTION, utf8_prefix(line, 38), false)
      fact_y = fact_y + 32
    end
    ev[#ev + 1] = text_ev(7, detail_x, math.min(fact_y + 12, SHEET_Y + SHEET_H - 120), 20,
      focused.unavailable == true and C_ERROR or C_SECONDARY, utf8_prefix(explanation, 42), false)
  elseif #candidates == 1 then
    ev[#ev + 1] = text_ev(7, detail_x, detail_y, 28, C_PRIMARY, "No alternatives", false)
    ev[#ev + 1] = text_ev(7, detail_x, detail_y + 44, 20, C_CAPTION,
      "The current stream is the only source available.", false)
  end

  if stream_state and type(stream_state.error) == "string" and stream_state.error ~= "" then
    ev[#ev + 1] = rounded_rect(SHEET_X + PAD, SHEET_Y + SHEET_H - 92, SHEET_W - PAD * 2, 44, 10, C_ERROR, "&H14&")
    ev[#ev + 1] = text_ev(5, SHEET_X + math.floor(SHEET_W / 2), SHEET_Y + SHEET_H - 70, 20, C_PRIMARY,
      utf8_prefix(stream_state.error, 88), false)
  else
    ev[#ev + 1] = draw_legend(
      SHEET_X + math.floor(SHEET_W / 2),
      SHEET_Y + SHEET_H - 42,
      {
        { key = "↑↓", label = "Choose" },
        { key = "B", label = "Select" },
        { key = "Y", label = "Close" },
      }
    )
  end
  return table.concat(ev, "\n")
end

local function build_badge_ass(label, colour)
  local width = math.max(160, utf8_len(label) * 16 + 48)
  local height = 52
  local x = math.floor((CANVAS_W - width) / 2)
  local y = math.floor(CANVAS_H / 2) - math.floor(height / 2)
  local function fade_in(event)
    return event:gsub("^%{", "{\\fad(180,0)", 1)
  end
  local events = { rounded_rect(x, y, width, height, 12, C_WHITE, A_PILL) }
  local faded = {}
  for index, event in ipairs(events) do
    faded[index] = fade_in(event)
  end
  faded[#faded + 1] = fade_in(text_ev(5, CANVAS_W / 2, y + math.floor(height / 2), 28, colour or C_PRIMARY, label, false))
  return table.concat(faded, "\n")
end

local function build_ass()
  if overlay_mode == "streams" then return build_streams_ass() end
  if overlay_mode == "buffering" then return build_badge_ass("Buffering", C_PRIMARY) end
  if overlay_mode == "pause_badge" then return build_badge_ass("Paused", C_PRIMARY) end
  if overlay_mode == "hud" or overlay_mode == "confirmation" then return build_hud_ass() end
  return ""
end

render = function()
  -- Keep the overlay id alive. Calling remove() can leave later update()
  -- unable to put chrome back, so A/↑ keep working while the HUD stays gone.
  if overlay_mode == "hidden" then
    overlay.data = ""
    overlay.hidden = true
    overlay:update()
    return
  end
  overlay.data = build_ass()
  overlay.hidden = false
  overlay:update()
end

local function stop_hud_timers()
  hide_timer = stop_timer(hide_timer)
  tick_timer = stop_timer(tick_timer)
end

local function settle_after_hud()
  stop_hud_timers()
  visible = false
  confirmation_copy = ""
  if buffering then
    overlay_mode = "buffering"
  elseif mp.get_property_native("pause") == true then
    overlay_mode = "pause_badge"
  else
    overlay_mode = "hidden"
  end
  write_visible_state(false, overlay_mode, 0)
  render()
end

local function show_hud(reason, forced_seconds)
  if overlay_mode == "streams" then return end
  hud_reason = reason or "show"
  local seconds = forced_seconds or dwell_seconds(hud_reason)
  overlay_mode = hud_reason == "confirmation" and "confirmation" or "hud"
  visible = true
  overlay.hidden = false
  write_visible_state(true, overlay_mode, seconds)
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
  write_visible_state(true, "streams", 86400)
  render()
end

local function show_request_error(message)
  PLAYBACK_TITLE = message
  PLAYBACK_CONTEXT = ""
  show_hud("error", LONG_SEC)
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
        write_visible_state(false, "buffering", 0)
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
    confirmation_copy = ""
    if name == "paused" then overlay_mode = "pause_badge"
    elseif name == "buffering" then overlay_mode = "buffering"
    elseif name == "seek" then hud_reason = "seek:-10"; overlay_mode = "hud"
    elseif name == "volume" then hud_reason = "volume"; overlay_mode = "hud"
    elseif name == "subs" then hud_reason = "subs"; overlay_mode = "hud"
    elseif name == "subs-off" then hud_reason = "show"; overlay_mode = "hud"
    elseif name == "audio" then hud_reason = "audio"; overlay_mode = "hud"
    elseif name == "live" then hud_reason = "show"; overlay_mode = "hud"
    elseif name == "confirmation" then
      hud_reason = "confirmation"
      confirmation_copy = "Now playing"
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
  confirmation_copy = START_CONFIRMATION
  hud_reason = "confirmation"
  overlay_mode = "confirmation"
  visible = true
  confirmation_until = mp.get_time() + LONG_SEC
  write_visible_state(true, "confirmation", LONG_SEC)
  render()
  hide_timer = mp.add_timeout(LONG_SEC, settle_after_hud)
elseif START_REOPEN_STREAMS then
  mp.add_timeout(1.0, open_streams)
end

mp.register_event("shutdown", function()
  pcall(write_visible_state, false, "hidden")
end)
