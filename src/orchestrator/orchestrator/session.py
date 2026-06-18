from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

OverlayState = Literal["idle", "listening", "thinking", "speaking"]


@dataclass
class ChatMessage:
    role: Literal["user", "assistant"]
    text: str


@dataclass
class SessionState:
    overlay_state: OverlayState = "idle"
    overlay_text: str = "idle"
    messages: list[ChatMessage] = field(default_factory=list)

    def set_overlay(self, state: OverlayState, text: str | None = None) -> None:
        self.overlay_state = state
        self.overlay_text = text if text is not None else state
