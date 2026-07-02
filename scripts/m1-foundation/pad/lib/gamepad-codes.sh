#!/usr/bin/env bash
# Shared 8BitDo Micro evdev codes (Switch BT → "Pro Controller").

# Face cluster (clockwise from left): Y · X · A · B
export MANGO_BTN_SELECT_FACE=304   # B — bottom — confirm
export MANGO_BTN_SHUFFLE_FACE=307  # X — top — reshuffle launcher rails
export MANGO_BTN_BACK_FACE=308       # Y — left — in-app back only

# Center grid (typical Switch layout on Micro):
#   [− 314]  [+ 315]
#   [317 ]  [316]  ← bottom-left currently unused; home = bottom-right (MODE)
export MANGO_BTN_MINUS=314           # BTN_SELECT — volume down
export MANGO_BTN_PLUS=315            # BTN_START — volume up
export MANGO_BTN_SHUFFLE=307         # BTN_NORTH — X face button
export MANGO_BTN_TAB_PREV=310        # BTN_TL — L shoulder (launcher tabs)
export MANGO_BTN_TAB_NEXT=311        # BTN_TR — R shoulder (launcher tabs)
export MANGO_BTN_HOME=316            # BTN_MODE — center-bottom-right (primary)
export MANGO_BTN_HOME_ALT=311        # BTN_TR — home fallback when not launcher
