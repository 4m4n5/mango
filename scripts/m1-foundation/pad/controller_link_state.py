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

    def mark_connected(self, now: float) -> None:
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
    def phase(self) -> str:
        if self.connected:
            return "ready"
        if self.attempt_in_flight:
            return "connecting"
        if not self.fast_retry_exhausted:
            return "fast_retry"
        return "maintenance_retry"
