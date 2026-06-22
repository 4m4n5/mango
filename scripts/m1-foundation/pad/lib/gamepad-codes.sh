#!/usr/bin/env bash
# Shared 8BitDo Micro evdev codes (Switch BT → "Pro Controller").

# Face cluster (clockwise from left): Y · X · A · B
export MANGO_BTN_SELECT_FACE=304   # B — bottom — confirm
export MANGO_BTN_BACK_FACE=308       # Y — left — in-app back only

# Center grid (typical Switch layout on Micro):
#   [− 314]  [+ 315]
#   [317 ]  [316]  ← shuffle = bottom-left (BTN_THUMBL); home = bottom-right (MODE)
export MANGO_BTN_MINUS=314           # BTN_SELECT
export MANGO_BTN_PLUS=315            # BTN_START
export MANGO_BTN_SHUFFLE=317         # BTN_THUMBL — bottom-left, left of home
export MANGO_BTN_TAB_PREV=310        # BTN_TL — L shoulder (launcher tabs)
export MANGO_BTN_TAB_NEXT=311        # BTN_TR — R shoulder (launcher tabs)
export MANGO_BTN_HOME=316            # BTN_MODE — center-bottom-right (primary)
export MANGO_BTN_HOME_ALT=311        # BTN_TR — home fallback when not launcher
