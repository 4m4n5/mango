#!/usr/bin/env python3
"""Pure retry policy for the Mango Bluetooth link supervisor.

The controller may be physically off for long periods. A failed connection is
therefore not a service failure: use a short recovery burst, then a quiet
maintenance cadence until BlueZ reports a connection.
"""

from __future__ import annotations

from dataclasses import dataclass


FAST_RETRY_DELAYS_SEC = (0.0, 1.0, 2.0, 4.0, 8.0)
MAINTENANCE_RETRY_SEC = 5.0


@dataclass
class LinkRetryState:
    fast_retry_delays_sec: tuple[float, ...] = FAST_RETRY_DELAYS_SEC
    maintenance_retry_sec: float = MAINTENANCE_RETRY_SEC
    connected: bool = False
    attempt_in_flight: bool = False
    attempt_started_at: float = 0.0
    retry_index: int = 0
    fast_retry_exhausted: bool = False
    next_attempt_at: float = 0.0
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
        self.next_attempt_at = 0.0
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
        self.next_attempt_at = now

    def mark_device_missing(self, now: float, error: str = "device_object_missing") -> None:
        """Keep retrying when BlueZ temporarily loses the known Device1 object."""
        self.device_present = False
        self.paired = None
        self.connected = False
        if self.attempt_in_flight:
            self.complete_attempt(now, error)
        else:
            self.last_error = error
            self.next_attempt_at = now

    def mark_device_resolved(self, now: float, *, paired: bool) -> None:
        self.device_present = True
        self.paired = paired
        if paired:
            self.force_retry(now)
        else:
            self.attempt_in_flight = False
            self.attempt_started_at = 0.0
            self.last_error = "pairing_record_missing"

    def due(self, now: float) -> bool:
        return not self.connected and not self.attempt_in_flight and now >= self.next_attempt_at

    def begin_attempt(self, now: float) -> None:
        self.attempt_in_flight = True
        self.attempt_started_at = now

    def complete_attempt(self, now: float, error: str = "") -> None:
        self.attempt_in_flight = False
        self.attempt_started_at = 0.0
        self.last_error = error
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
            self.next_attempt_at = now

    @property
    def retry_phase(self) -> str:
        if self.connected:
            return "ready"
        if self.attempt_in_flight:
            return "connecting"
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
        if not adapter_ready or self.attempt_in_flight or not self.fast_retry_exhausted:
            return "connecting"
        return "off"
