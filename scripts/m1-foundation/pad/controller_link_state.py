#!/usr/bin/env python3
"""Pure retry policy for the Mango Bluetooth link supervisor.

The 8BitDo Micro (Switch/Pro mode) normally reconnects by initiating to the
last bonded host after ordinary power-on. Host-side Connect() storms while the
peripheral radio is off (BlueZ "Host is down") race the HID stack when a second
owner (BlueZ Policy auto-reconnect) is also paging — ordinary wake then needs
pairing mode.

Policy (sole Connect owner; BlueZ ReconnectAttempts=0):
  - probe Connect on a short cadence while the bonded Micro looks off;
  - never overlap attempts; back off briefly on Host-is-down;
  - on advertising / RSSI wake evidence, Connect immediately;
  - never treat a powered-off Micro as a pairing failure.
"""

from __future__ import annotations

from dataclasses import dataclass


FAST_RETRY_DELAYS_SEC = (0.0, 0.5, 1.0, 2.0, 4.0)
MAINTENANCE_RETRY_SEC = 3.0
# How often we may StartDiscovery while awaiting a missing Device1 object /
# advertising evidence. Connect probes use asleep_probe_sec instead.
ASLEEP_SCAN_SEC = 2.0
# Sole-owner Connect probe interval after Host-is-down. Keep this short so
# ordinary power-on is paged within about one BlueZ attempt, not a 15s+ gap.
ASLEEP_PROBE_SEC = 1.0
ASLEEP_PROBE_MAX_SEC = 3.0
# After a disconnect, allow one immediate Connect before treating Host-is-down
# as "peripheral off".
DISCONNECT_GRACE_SEC = 1.0


def is_peripheral_asleep_error(error: str) -> bool:
    text = error.lower()
    return (
        "host is down" in text
        or "(112)" in error
        or "errno 112" in text
        or "br-connection-host-down" in text
    )


def is_pageable_timeout_error(error: str) -> bool:
    """Micro may be on but not accepting host Connect yet (ordinary wake window)."""
    text = error.lower()
    return (
        "connection timed out" in text
        or "(110)" in error
        or "errno 110" in text
        or "br-connection-page-timeout" in text
        or "br-connection-canceled" in text
    )


def is_connect_busy_error(error: str) -> bool:
    text = error.lower()
    return "already in progress" in text or "(114)" in error or "errno 114" in text


@dataclass
class LinkRetryState:
    fast_retry_delays_sec: tuple[float, ...] = FAST_RETRY_DELAYS_SEC
    maintenance_retry_sec: float = MAINTENANCE_RETRY_SEC
    asleep_scan_sec: float = ASLEEP_SCAN_SEC
    asleep_probe_sec: float = ASLEEP_PROBE_SEC
    asleep_probe_max_sec: float = ASLEEP_PROBE_MAX_SEC
    disconnect_grace_sec: float = DISCONNECT_GRACE_SEC
    connected: bool = False
    attempt_in_flight: bool = False
    attempt_started_at: float = 0.0
    retry_index: int = 0
    fast_retry_exhausted: bool = False
    # True while BlueZ says the bonded Micro radio is off. Connect still probes
    # on asleep_probe_sec; we just avoid overlapping / dual-owner storms.
    peripheral_asleep: bool = False
    # True after we saw advertising / RSSI / services while asleep — prefer
    # immediate Connect over the probe cadence.
    wake_detected: bool = False
    asleep_probe_streak: int = 0
    next_attempt_at: float = 0.0
    next_scan_at: float = 0.0
    last_disconnect_at: float = 0.0
    last_connected_at: float = 0.0
    last_error: str = ""
    device_present: bool = True
    paired: bool | None = None

    def mark_connected(self, now: float) -> None:
        self.device_present = True
        self.connected = True
        self.attempt_in_flight = False
        self.attempt_started_at = 0.0
        self.retry_index = 0
        self.fast_retry_exhausted = False
        self.peripheral_asleep = False
        self.wake_detected = False
        self.asleep_probe_streak = 0
        self.next_attempt_at = 0.0
        self.next_scan_at = 0.0
        self.last_connected_at = now
        self.last_error = ""

    def mark_disconnected(self, now: float) -> None:
        if self.connected:
            self.last_disconnect_at = now
        self.connected = False
        self.attempt_in_flight = False
        self.attempt_started_at = 0.0
        self.retry_index = 0
        self.fast_retry_exhausted = False
        self.peripheral_asleep = False
        self.wake_detected = False
        self.asleep_probe_streak = 0
        # One grace Connect is allowed; Host-is-down then parks us in asleep.
        self.next_attempt_at = now + self.disconnect_grace_sec
        self.next_scan_at = now + self.disconnect_grace_sec

    def mark_device_missing(self, now: float, error: str = "device_object_missing") -> None:
        """Keep retrying when BlueZ temporarily loses the known Device1 object."""
        self.device_present = False
        self.paired = None
        self.connected = False
        self.peripheral_asleep = False
        self.wake_detected = False
        if self.attempt_in_flight:
            self.complete_attempt(now, error)
        else:
            self.last_error = error
            self.next_attempt_at = now
            self.next_scan_at = now

    def mark_device_resolved(self, now: float, *, paired: bool) -> None:
        was_missing = not self.device_present
        self.device_present = True
        self.paired = paired
        if not paired:
            self.attempt_in_flight = False
            self.attempt_started_at = 0.0
            self.last_error = "pairing_record_missing"
            return
        # Only burst Connect when BlueZ recreates a missing Device1 object.
        # Rebinding an already-tracked paired device must not clear asleep probes.
        if was_missing:
            self.force_retry(now)

    def mark_peripheral_asleep(self, now: float, error: str = "") -> None:
        self.peripheral_asleep = True
        self.wake_detected = False
        self.attempt_in_flight = False
        self.attempt_started_at = 0.0
        self.fast_retry_exhausted = True
        self.retry_index = len(self.fast_retry_delays_sec) - 1
        if error:
            self.last_error = error
        delay = min(
            self.asleep_probe_sec * (2 ** self.asleep_probe_streak),
            self.asleep_probe_max_sec,
        )
        self.asleep_probe_streak += 1
        self.next_attempt_at = now + delay
        self.next_scan_at = now

    def mark_wake_detected(self, now: float) -> None:
        """Advertising / RSSI / services appeared — Connect as soon as possible."""
        if self.connected:
            return
        self.wake_detected = True
        self.asleep_probe_streak = 0
        self.peripheral_asleep = False
        self.retry_index = 0
        self.fast_retry_exhausted = False
        self.next_attempt_at = now
        # Do not clear attempt_in_flight: an in-flight Connect may be the wake page.

    def due(self, now: float) -> bool:
        if self.connected or self.attempt_in_flight:
            return False
        return now >= self.next_attempt_at

    def scan_due(self, now: float) -> bool:
        return (
            not self.connected
            and not self.attempt_in_flight
            and now >= self.next_scan_at
            and (self.peripheral_asleep or not self.device_present)
        )

    def begin_attempt(self, now: float) -> None:
        self.attempt_in_flight = True
        self.attempt_started_at = now

    def complete_attempt(self, now: float, error: str = "") -> None:
        self.attempt_in_flight = False
        self.attempt_started_at = 0.0
        self.last_error = error
        if is_connect_busy_error(error):
            # Another BlueZ client/page is in flight; wait briefly without
            # escalating retry phase.
            self.next_attempt_at = now + min(0.5, self.asleep_probe_sec)
            return
        if is_peripheral_asleep_error(error):
            self.mark_peripheral_asleep(now, error)
            return
        if is_pageable_timeout_error(error) and not self.wake_detected:
            # Timed out without wake evidence — Micro may still be off. Probe
            # again shortly rather than opening a long dark window.
            self.mark_peripheral_asleep(now, error)
            return
        self.peripheral_asleep = False
        if self.retry_index < len(self.fast_retry_delays_sec) - 1:
            self.retry_index += 1
            self.next_attempt_at = now + self.fast_retry_delays_sec[self.retry_index]
        else:
            self.fast_retry_exhausted = True
            self.next_attempt_at = now + self.maintenance_retry_sec

    def force_retry(self, now: float) -> None:
        if not self.connected:
            self.attempt_in_flight = False
            self.attempt_started_at = 0.0
            self.retry_index = 0
            self.fast_retry_exhausted = False
            self.peripheral_asleep = False
            self.wake_detected = True
            self.asleep_probe_streak = 0
            self.next_attempt_at = now
            self.next_scan_at = now

    @property
    def retry_phase(self) -> str:
        if self.connected:
            return "ready"
        if self.attempt_in_flight:
            return "connecting"
        if self.peripheral_asleep and not self.wake_detected:
            return "awaiting_peripheral"
        if not self.fast_retry_exhausted:
            return "fast_retry"
        return "maintenance_retry"

    @property
    def needs_re_pair(self) -> bool:
        return self.device_present and self.paired is False

    def couch_state(self, *, adapter_ready: bool, input_ready: bool) -> str:
        """Return the stable public state used by pad health and Reliability."""
        if self.connected:
            return "ready" if input_ready else "connected_waiting_for_input"
        if self.needs_re_pair:
            return "needs_re-pair"
        if not adapter_ready or self.attempt_in_flight or (
            not self.fast_retry_exhausted and not self.peripheral_asleep
        ):
            return "connecting"
        return "off"
