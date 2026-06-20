from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

OverlayState = Literal["idle", "listening", "thinking", "speaking"]
ChatRole = Literal["user", "assistant"]


@dataclass
class ChatMessage:
    role: ChatRole
    text: str


@dataclass
class VoiceBrowseContext:
    """Recent search hits for follow-up picks ('the second one', 'open that')."""

    library_hits: list[dict[str, Any]] = field(default_factory=list)
    external_hits: list[dict[str, Any]] = field(default_factory=list)

    def all_hits(self) -> list[dict[str, Any]]:
        return [*self.library_hits, *self.external_hits]

    def remember_library(self, hits: list[dict[str, Any]]) -> None:
        if hits:
            self.library_hits = hits[:8]

    def remember_external(self, hits: list[dict[str, Any]]) -> None:
        if hits:
            self.external_hits = hits[:8]


@dataclass
class SessionState:
    overlay_state: OverlayState = "idle"
    overlay_text: str = "idle"
    messages: list[ChatMessage] = field(default_factory=list)
    voice_browse: VoiceBrowseContext = field(default_factory=VoiceBrowseContext)

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
