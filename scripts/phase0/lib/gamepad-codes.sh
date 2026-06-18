#!/usr/bin/env bash
# Shared 8BitDo Micro evdev codes (Switch BT → "Pro Controller").

# Face cluster (clockwise from left): Y · X · A · B
export MANGO_BTN_SELECT_FACE=304   # B — bottom — confirm
export MANGO_BTN_BACK_FACE=308       # Y — left — in-app back only

# Center pair: minus (left), plus (right)
export MANGO_BTN_SELECT_CENTER=314   # BTN_SELECT — minus
export MANGO_BTN_HOME=315            # BTN_START — plus — return to mango launcher
