from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

OverlayState = Literal["idle", "listening", "thinking", "speaking"]
ChatRole = Literal["user", "assistant"]


@dataclass
class ChatMessage:
    role: ChatRole
    text: str


@dataclass
class SessionState:
    overlay_state: OverlayState = "idle"
    overlay_text: str = "idle"
    messages: list[ChatMessage] = field(default_factory=list)

    def set_overlay(self, state: OverlayState, text: str | None = None) -> None:
        self.overlay_state = state
        self.overlay_text = text if text is not None else state

    def add_message(self, role: ChatRole, text: str) -> ChatMessage:
        message = ChatMessage(role=role, text=text.strip())
        self.messages.append(message)
        return message

    def provider_messages(self, *, max_turns: int | None = None) -> list[dict[str, str]]:
        """LLM API shape — Anthropic/OpenAI expect ``content``, not ``text``."""
        messages = self.messages
        if max_turns is not None and max_turns > 0:
            keep = max_turns * 2
            messages = messages[-keep:]
        return [{"role": message.role, "content": message.text} for message in messages]
