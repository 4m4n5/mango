#!/usr/bin/env bash
# Shared 8BitDo Micro evdev codes (Switch BT → "Pro Controller").

# Face cluster (clockwise from left): Y · X · A · B
export MANGO_BTN_SELECT_FACE=304   # B — bottom — confirm
export MANGO_BTN_BACK_FACE=308       # Y — left — in-app back only

# Center grid (typical Switch layout on Micro):
#   [− 314]  [+ 315]
#   [310 ]  [316]  ← refresh = bottom-left (BTN_TL); home = bottom-right (MODE)
export MANGO_BTN_MINUS=314           # BTN_SELECT
export MANGO_BTN_PLUS=315            # BTN_START
export MANGO_BTN_REFRESH=310         # BTN_TL — bottom-left, left of home
export MANGO_BTN_HOME=316            # BTN_MODE — center-bottom-right (primary)
export MANGO_BTN_HOME_ALT=311        # BTN_TR — fallback if MODE not wired
