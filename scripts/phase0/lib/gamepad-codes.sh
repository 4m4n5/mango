#!/usr/bin/env bash
# Shared 8BitDo Micro evdev codes (Switch BT → "Pro Controller").

# Face cluster (clockwise from left): Y · X · A · B
export MANGO_BTN_SELECT_FACE=304   # B — bottom — confirm
export MANGO_BTN_BACK_FACE=308       # Y — left — in-app back only

# Center pair: minus (left), plus (right)
export MANGO_BTN_SELECT_CENTER=314   # BTN_SELECT — minus (−), center-left / under +
export MANGO_BTN_PLUS=315            # BTN_START — plus (+) — unused
export MANGO_BTN_HOME=314            # − button → mango launcher
